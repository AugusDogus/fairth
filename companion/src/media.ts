import * as MediaLibrary from "expo-media-library/legacy";
import { enqueue, setSettingValue, settingValue } from "./database";
import type { SyncSettings } from "./types";

export type AlbumChoice = Readonly<{ id: string; title: string; assetCount: number }>;
export type MediaChoice = Readonly<{
  id: string;
  filename: string;
  uri: string;
  mediaType: "photo" | "video";
  creationTime: number;
}>;

function supportedAsset(asset: MediaLibrary.Asset): MediaChoice | undefined {
  if (asset.mediaType !== MediaLibrary.MediaType.photo && asset.mediaType !== MediaLibrary.MediaType.video) return undefined;
  return {
    id: asset.id,
    filename: asset.filename,
    uri: asset.uri,
    mediaType: asset.mediaType,
    creationTime: asset.creationTime,
  };
}

export async function requestMediaAccess(): Promise<boolean> {
  const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]);
  return permission.granted;
}

export async function listAlbums(): Promise<AlbumChoice[]> {
  const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
  return albums.map((album) => ({ id: album.id, title: album.title, assetCount: album.assetCount }));
}

export async function recentMedia(limit = 40): Promise<MediaChoice[]> {
  const page = await MediaLibrary.getAssetsAsync({
    first: limit,
    mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
  });
  return page.assets.flatMap((asset) => {
    const supported = supportedAsset(asset);
    return supported === undefined ? [] : [supported];
  });
}

export async function enqueueChoices(choices: readonly MediaChoice[], album = "manual"): Promise<number> {
  for (const choice of choices) {
    await enqueue({
      assetId: choice.id,
      uri: choice.uri,
      filename: choice.filename,
      mediaType: choice.mediaType,
      createdAt: choice.creationTime,
      album,
    });
  }
  return choices.length;
}

async function assetsForAlbum(albumId: string | undefined, createdAfter: number): Promise<MediaLibrary.Asset[]> {
  const assets: MediaLibrary.Asset[] = [];
  let after: string | undefined;
  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: 250,
      ...(after === undefined ? {} : { after }),
      ...(albumId === undefined ? {} : { album: albumId }),
      createdAfter,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      sortBy: [[MediaLibrary.SortBy.creationTime, true]],
    });
    assets.push(...page.assets);
    after = page.hasNextPage ? page.endCursor : undefined;
  } while (after !== undefined);
  return assets;
}

export async function detectNewMedia(settings: SyncSettings): Promise<number> {
  const permission = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
  if (!permission.granted) return 0;
  const albumIds: readonly (string | undefined)[] = settings.albumIds.length === 0 ? [undefined] : settings.albumIds;
  const seen = new Set<string>();
  let count = 0;
  for (const albumId of albumIds) {
    const cursorKey = `last-media-scan:${albumId ?? "camera-roll"}`;
    const storedCursor = Number(await settingValue(cursorKey) ?? "0");
    const cursor = Number.isFinite(storedCursor) ? storedCursor : 0;
    let maximum = cursor;
    for (const asset of await assetsForAlbum(albumId, Math.max(0, cursor - 1))) {
      const choice = supportedAsset(asset);
      if (choice === undefined || seen.has(choice.id)) continue;
      seen.add(choice.id);
      maximum = Math.max(maximum, choice.creationTime);
      await enqueueChoices([choice], albumId ?? "camera-roll");
      count += 1;
    }
    if (maximum > cursor) await setSettingValue(cursorKey, String(maximum));
  }
  return count;
}

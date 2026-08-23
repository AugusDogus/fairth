import * as MediaLibrary from "expo-media-library/legacy";
import type { ShareIntentFile } from "expo-share-intent";
import { PermissionsAndroid, Platform } from "react-native";
import BackgroundUpload from "../modules/fairth-background-upload";

export type AlbumChoice = Readonly<{ id: string; title: string; assetCount: number }>;
export type MediaChoice = Readonly<{
  id: string;
  filename: string;
  uri: string;
  mediaType: "photo" | "video";
  creationTime: number;
}>;

export async function hasMediaAccess(): Promise<boolean> {
  const permission = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
  return permission.granted && await hasOriginalMediaAccess();
}

async function hasOriginalMediaAccess(): Promise<boolean> {
  if (Platform.OS !== "android" || Platform.Version < 29) return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION);
}

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
  if (!permission.granted) return false;
  if (await hasOriginalMediaAccess()) return true;
  return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION) === PermissionsAndroid.RESULTS.GRANTED;
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

export async function enqueueChoices(choices: readonly MediaChoice[]): Promise<number> {
  return BackgroundUpload.enqueueManualAssets(JSON.stringify(choices));
}

export async function enqueueSharedImages(files: readonly ShareIntentFile[]): Promise<number> {
  try {
    return await BackgroundUpload.enqueueSharedImages(JSON.stringify(files));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const cause = error.message.match(/Caused by: [\w.$]+(?:Exception|Error):\s*([\s\S]+)$/)?.[1]?.trim();
    throw new Error(cause ?? error.message);
  }
}

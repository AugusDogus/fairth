import { useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { BackgroundUploadEntry } from "../modules/fairth-background-upload";
import { appColor as color } from "./screens";
import { groupUploadHistory, uploadEntryDetail, uploadFailureDetail } from "./upload-history";

export type UploadHistoryScreenProps = Readonly<{
  actionError: string | null;
  entries: readonly BackgroundUploadEntry[];
  loadError: string | null;
  loadMoreError: string | null;
  loading: boolean;
  loadingMore: boolean;
  onBack: () => void;
  onLoadMore: () => void;
  onReload: () => void;
  onRetry: (id: string) => void;
  retryingId: string | null;
}>;

type HistoryListItem =
  | Readonly<{ key: string; kind: "section"; title: string }>
  | Readonly<{ entry: BackgroundUploadEntry; first: boolean; key: string; kind: "entry" }>;

function historyListItems(entries: readonly BackgroundUploadEntry[]): readonly HistoryListItem[] {
  const groups = groupUploadHistory(entries);
  const sections = [
    { entries: groups.failures, key: "failures", title: "Needs attention" },
    { entries: groups.active, key: "active", title: "In progress" },
    { entries: groups.completed, key: "completed", title: "Completed" },
  ] as const;
  const items: HistoryListItem[] = [];
  for (const section of sections) {
    if (section.entries.length === 0) continue;
    items.push({ key: `section:${section.key}`, kind: "section", title: section.title });
    section.entries.forEach((entry, index) => {
      items.push({ entry, first: index === 0, key: `entry:${entry.id}`, kind: "entry" });
    });
  }
  return items;
}

function BackIcon() {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path d="m15 18-6-6 6-6" fill="none" stroke={color.ink} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </Svg>
  );
}

function StatusGlyph({ status }: Readonly<{ status: BackgroundUploadEntry["status"] }>) {
  const path = status === "retry"
    ? "M12 7.5v5M12 16.25h.01"
    : status === "uploaded"
      ? "m7 12.5 3.2 3.2L17 8.8"
      : status === "uploading"
        ? "M12 17V7m-4 4 4-4 4 4"
        : "M12 7v5l3 2";
  return (
    <Svg height={14} viewBox="0 0 24 24" width={14}>
      <Path d={path} fill="none" stroke={color.white} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
    </Svg>
  );
}

function PhotoFallback() {
  return (
    <Svg height={25} viewBox="0 0 24 24" width={25}>
      <Path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17V7a1.5 1.5 0 0 1 1.5-1.5Z" fill="none" stroke={color.primary} strokeLinejoin="round" strokeWidth={1.7} />
      <Path d="m6.5 15.5 3.1-3.1 2.5 2.4 2.7-3.3 2.7 4M8.5 9.5h.01" fill="none" stroke={color.primary} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} />
    </Svg>
  );
}

function PhotoThumbnail({ entry }: Readonly<{ entry: BackgroundUploadEntry }>) {
  const [failed, setFailed] = useState(false);
  const statusStyle = entry.status === "retry"
    ? styles.statusFailure
    : entry.status === "uploaded"
      ? styles.statusComplete
      : styles.statusActive;
  return (
    <View style={[styles.thumbnail, entry.status === "retry" ? styles.thumbnailFailure : undefined]}>
      {failed ? (
        <PhotoFallback />
      ) : (
        <Image accessible={false} onError={() => setFailed(true)} resizeMode="cover" source={{ uri: entry.uri }} style={styles.thumbnailImage} />
      )}
      <View style={[styles.statusBadge, statusStyle]}>
        <StatusGlyph status={entry.status} />
      </View>
    </View>
  );
}

function UploadRow({ entry, first, onRetry, retrying }: Readonly<{
  entry: BackgroundUploadEntry;
  first: boolean;
  onRetry: (id: string) => void;
  retrying: boolean;
}>) {
  const failed = entry.status === "retry";
  return (
    <View style={[styles.uploadRow, first ? styles.firstUploadRow : undefined]}>
      <PhotoThumbnail entry={entry} />
      <View style={styles.uploadCopy}>
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.filename}>{entry.filename}</Text>
        <Text style={[styles.uploadMeta, failed ? styles.failureMeta : undefined]}>{uploadEntryDetail(entry)}</Text>
        {failed ? <Text style={styles.failureDetail}>{uploadFailureDetail(entry.lastError)}</Text> : null}
        {failed ? (
          <Pressable
            accessibilityLabel={`Retry ${entry.filename}`}
            accessibilityRole="button"
            disabled={retrying}
            onPress={() => onRetry(entry.id)}
            style={({ pressed }) => [styles.retryButton, pressed ? styles.buttonPressed : undefined, retrying ? styles.buttonDisabled : undefined]}
          >
            {retrying ? <ActivityIndicator color={color.primary} size="small" /> : <Text style={styles.buttonText}>Retry now</Text>}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function EmptyState({ error, loading, onReload }: Readonly<{
  error: string | null;
  loading: boolean;
  onReload: () => void;
}>) {
  if (loading) return <ActivityIndicator color={color.primary} style={styles.loader} />;
  if (error !== null) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.errorBox}>
        <Text style={styles.errorTitle}>Couldn’t load uploads</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={onReload} style={({ pressed }) => [styles.outlineButton, pressed ? styles.buttonPressed : undefined]}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}><PhotoFallback /></View>
      <Text style={styles.emptyTitle}>No uploads yet</Text>
      <Text style={styles.emptyBody}>Share a photo to Fairth or wait for camera backup to find one.</Text>
    </View>
  );
}

export function UploadHistoryScreen({
  actionError,
  entries,
  loadError,
  loadMoreError,
  loading,
  loadingMore,
  onBack,
  onLoadMore,
  onReload,
  onRetry,
  retryingId,
}: UploadHistoryScreenProps) {
  const items = historyListItems(entries);
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back" accessibilityRole="button" hitSlop={10} onPress={onBack} style={({ pressed }) => [styles.backButton, pressed ? styles.backButtonPressed : undefined]}>
          <BackIcon />
        </Pressable>
        <Text style={styles.title}>Uploads</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        contentContainerStyle={items.length === 0 ? styles.emptyListContent : styles.listContent}
        data={items}
        initialNumToRender={14}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={<EmptyState error={loadError} loading={loading} onReload={onReload} />}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator color={color.primary} style={styles.footerLoader} />
        ) : loadMoreError === null ? null : (
          <View accessibilityLiveRegion="polite" style={styles.loadMoreError}>
            <Text style={styles.loadMoreErrorText}>{loadMoreError}</Text>
            <Pressable accessibilityRole="button" onPress={onLoadMore} style={({ pressed }) => [styles.footerRetry, pressed ? styles.buttonPressed : undefined]}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        )}
        ListHeaderComponent={actionError === null ? null : (
          <View accessibilityLiveRegion="polite" style={styles.actionError}>
            <Text style={styles.actionErrorText}>{actionError}</Text>
          </View>
        )}
        maxToRenderPerBatch={12}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.35}
        renderItem={({ item }) => item.kind === "section" ? (
          <Text style={styles.sectionTitle}>{item.title}</Text>
        ) : (
          <UploadRow entry={item.entry} first={item.first} onRetry={onRetry} retrying={retryingId === item.entry.id} />
        )}
        showsVerticalScrollIndicator={false}
        windowSize={7}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionError: { backgroundColor: color.errorSoft, borderRadius: 14, marginBottom: 6, marginTop: 18, paddingHorizontal: 15, paddingVertical: 13 },
  actionErrorText: { color: color.error, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  backButton: { alignItems: "center", borderRadius: 99, height: 42, justifyContent: "center", marginLeft: -9, width: 42 },
  backButtonPressed: { backgroundColor: color.borderSoft, transform: [{ scale: 0.96 }] },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { backgroundColor: color.primarySoft, transform: [{ scale: 0.98 }] },
  buttonText: { color: color.primary, fontSize: 13, fontWeight: "800" },
  emptyBody: { color: color.muted, fontSize: 14, lineHeight: 21, marginTop: 6, maxWidth: 270, textAlign: "center" },
  emptyIcon: { alignItems: "center", backgroundColor: color.primarySoft, borderRadius: 16, height: 56, justifyContent: "center", width: 56 },
  emptyListContent: { flexGrow: 1, paddingHorizontal: 22 },
  emptyState: { alignItems: "center", paddingHorizontal: 20, paddingTop: 94 },
  emptyTitle: { color: color.ink, fontSize: 18, fontWeight: "800", marginTop: 16 },
  errorBody: { color: color.body, fontSize: 14, lineHeight: 20, marginTop: 4 },
  errorBox: { backgroundColor: color.errorSoft, borderRadius: 16, marginTop: 24, padding: 16 },
  errorTitle: { color: color.error, fontSize: 16, fontWeight: "800" },
  failureDetail: { color: color.body, fontSize: 13, lineHeight: 19, marginTop: 6 },
  failureMeta: { color: color.error },
  filename: { color: color.ink, fontSize: 15, fontWeight: "700" },
  firstUploadRow: { borderTopColor: color.borderSoft, borderTopWidth: StyleSheet.hairlineWidth },
  footerLoader: { marginVertical: 24 },
  footerRetry: { alignItems: "center", borderColor: color.border, borderRadius: 10, borderWidth: 1, height: 38, justifyContent: "center", marginTop: 10, paddingHorizontal: 14 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 46, paddingHorizontal: 22, paddingTop: 14 },
  headerSpacer: { width: 33 },
  listContent: { paddingBottom: 30, paddingHorizontal: 22 },
  loader: { marginTop: 80 },
  loadMoreError: { alignItems: "center", paddingVertical: 24 },
  loadMoreErrorText: { color: color.error, fontSize: 13, lineHeight: 19, textAlign: "center" },
  outlineButton: { alignItems: "center", alignSelf: "flex-start", borderColor: color.border, borderRadius: 10, borderWidth: 1, height: 38, justifyContent: "center", marginTop: 14, paddingHorizontal: 14 },
  retryButton: { alignItems: "center", alignSelf: "flex-start", borderColor: color.border, borderRadius: 10, borderWidth: 1, height: 38, justifyContent: "center", marginTop: 12, minWidth: 94, paddingHorizontal: 14 },
  screen: { backgroundColor: color.background, flex: 1 },
  sectionTitle: { color: color.ink, fontSize: 18, fontWeight: "800", letterSpacing: -0.2, marginTop: 28, paddingBottom: 9 },
  statusActive: { backgroundColor: color.primary },
  statusBadge: { alignItems: "center", borderColor: color.background, borderRadius: 99, borderWidth: 2, bottom: -4, height: 24, justifyContent: "center", position: "absolute", right: -4, width: 24 },
  statusComplete: { backgroundColor: color.success },
  statusFailure: { backgroundColor: color.error },
  thumbnail: { alignItems: "center", backgroundColor: color.primarySoft, borderColor: color.borderSoft, borderRadius: 13, borderWidth: 1, height: 56, justifyContent: "center", width: 56 },
  thumbnailFailure: { borderColor: "#FDA29B" },
  thumbnailImage: { borderRadius: 12, height: "100%", width: "100%" },
  title: { color: color.ink, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  uploadCopy: { flex: 1, paddingTop: 4 },
  uploadMeta: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: 2 },
  uploadRow: { alignItems: "flex-start", borderBottomColor: color.borderSoft, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 14, paddingVertical: 14 },
});

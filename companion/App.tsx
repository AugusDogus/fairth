import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as MediaLibrary from "expo-media-library/legacy";
import { getToken, saveToken } from "./src/credentials";
import { initializeDatabase, loadSettings, saveSettings } from "./src/database";
import { beginEnrollment, completeEnrollment } from "./src/enrollment";
import { enqueueChoices, listAlbums, recentMedia, requestMediaAccess, type AlbumChoice, type MediaChoice } from "./src/media";
import { configureBackgroundSync, syncCycle, uploadStatus } from "./src/sync";
import type { SyncSettings } from "./src/types";
import { defaultSettings } from "./src/types";

type Counts = Readonly<{ pending: number; retry: number; uploaded: number }>;

function Field(props: Readonly<{ label: string; value: string; onChange: (value: string) => void; secret?: boolean; keyboard?: "default" | "numeric" }>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={props.keyboard ?? "default"}
        onChangeText={props.onChange}
        placeholderTextColor="#718096"
        secureTextEntry={props.secret === true}
        style={styles.input}
        value={props.value}
      />
    </View>
  );
}

function Toggle(props: Readonly<{ label: string; detail: string; value: boolean; onChange: (value: boolean) => void }>) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{props.label}</Text>
        <Text style={styles.detail}>{props.detail}</Text>
      </View>
      <Switch onValueChange={props.onChange} trackColor={{ false: "#334155", true: "#2dd4bf" }} value={props.value} />
    </View>
  );
}

export default function App() {
  const [settings, setSettings] = useState<SyncSettings>(defaultSettings);
  const [enrolled, setEnrolled] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | undefined>();
  const [albums, setAlbums] = useState<AlbumChoice[]>([]);
  const [recent, setRecent] = useState<MediaChoice[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [counts, setCounts] = useState<Counts>({ pending: 0, retry: 0, uploaded: 0 });
  const [message, setMessage] = useState("Preparing media library…");
  const [busy, setBusy] = useState(true);

  async function refreshCounts(): Promise<void> {
    const status = await uploadStatus();
    setCounts({ pending: status.pending, retry: status.retry, uploaded: status.uploaded });
    if (status.lastError.length > 0) setMessage(status.lastError);
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await initializeDatabase();
        const granted = await requestMediaAccess();
        const [savedSettings, savedToken] = await Promise.all([loadSettings(), getToken()]);
        if (savedToken !== undefined) await configureBackgroundSync(savedSettings, savedToken);
        if (!mounted) return;
        setSettings(savedSettings);
        setEnrolled(savedToken !== undefined);
        if (granted) {
          const [albumChoices, mediaChoices] = await Promise.all([listAlbums(), recentMedia()]);
          if (!mounted) return;
          setAlbums(albumChoices);
          setRecent(mediaChoices);
          setMessage("Ready to sync.");
        } else {
          setMessage("Photo permission is required before media can be queued.");
        }
        await refreshCounts();
      } catch (error) {
        if (mounted) setMessage(error instanceof Error ? error.message : "Setup failed.");
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!settings.automaticSync) return undefined;
    const subscription = MediaLibrary.addListener(() => {
      void syncCycle(settings).catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Android could not schedule the media change.");
      });
    });
    return () => subscription.remove();
  }, [settings]);

  function update(patch: Partial<SyncSettings>): void {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function persist(): Promise<void> {
    setBusy(true);
    try {
      await saveSettings(settings);
      await configureBackgroundSync(settings);
      setMessage("Settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function enrollDevice(): Promise<void> {
    setBusy(true);
    setMessage("Requesting a device enrollment code…");
    try {
      const enrollmentEndpoint = settings.lanEndpoint.trim().length > 0 ? settings.lanEndpoint : settings.primaryEndpoint;
      const challenge = await beginEnrollment(enrollmentEndpoint);
      setPairingCode(challenge.userCode);
      setMessage(`Approve code ${challenge.userCode} in the owner page.`);
      await Linking.openURL(challenge.verificationUriComplete);
      const result = await completeEnrollment(challenge, settings.deviceId);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      await saveToken(result.token);
      await configureBackgroundSync(settings, result.token);
      setEnrolled(true);
      setPairingCode(undefined);
      setMessage("This device is enrolled. Automatic uploads can now run without reopening Fairth.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Device enrollment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runSync(): Promise<void> {
    setBusy(true);
    setMessage("Scanning and uploading…");
    try {
      setMessage(await syncCycle(settings));
      await refreshCounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Android could not schedule the upload.");
    } finally {
      setBusy(false);
    }
  }

  async function queueSelected(): Promise<void> {
    const choices = recent.filter((choice) => selected.has(choice.id));
    await enqueueChoices(choices);
    setSelected(new Set());
    setMessage(`Queued ${choices.length} selected item${choices.length === 1 ? "" : "s"}.`);
    await refreshCounts();
  }

  function toggleAlbum(id: string): void {
    update({ albumIds: settings.albumIds.includes(id) ? settings.albumIds.filter((value) => value !== id) : [...settings.albumIds, id] });
  }

  function toggleMedia(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>FAIRTH COMPANION</Text>
          <Text style={styles.title}>Your camera roll, queued safely.</Text>
          <Text style={styles.subtitle}>LAN first, resumable, and ready to continue when your phone comes back online.</Text>
        </View>

        <View style={styles.statusCard}>
          <View><Text style={styles.metric}>{counts.pending}</Text><Text style={styles.metricLabel}>Queued</Text></View>
          <View><Text style={styles.metric}>{counts.retry}</Text><Text style={styles.metricLabel}>Retrying</Text></View>
          <View><Text style={styles.metric}>{counts.uploaded}</Text><Text style={styles.metricLabel}>Uploaded</Text></View>
        </View>
        <Text style={styles.message}>{message}</Text>
        <Pressable disabled={busy} onPress={() => void runSync()} style={({ pressed }) => [styles.primary, pressed && styles.pressed, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color="#042f2e" /> : <Text style={styles.primaryText}>Sync now</Text>}
        </Pressable>

        <Text style={styles.sectionTitle}>Connection</Text>
        <Field label="LAN endpoint" onChange={(lanEndpoint) => update({ lanEndpoint })} value={settings.lanEndpoint} />
        <Field label="Remote fallback endpoint" onChange={(primaryEndpoint) => update({ primaryEndpoint })} value={settings.primaryEndpoint} />
        <Field label="Device ID" onChange={(deviceId) => update({ deviceId })} value={settings.deviceId} />
        <Text style={styles.detail}>{enrolled ? "Enrolled with a revocable device session." : "Not enrolled yet."}</Text>
        {pairingCode === undefined ? null : <Text style={styles.pairingCode}>{pairingCode}</Text>}
        <Pressable disabled={busy} onPress={() => void enrollDevice()} style={styles.secondary}><Text style={styles.secondaryText}>{enrolled ? "Replace device enrollment" : "Enroll this device"}</Text></Pressable>

        <Text style={styles.sectionTitle}>Sync rules</Text>
        <Toggle detail="Use cellular only when this is off." label="Wi-Fi only" onChange={(wifiOnly) => update({ wifiOnly })} value={settings.wifiOnly} />
        <Toggle detail="Keep queued work until external power is connected." label="Charging only" onChange={(chargingOnly) => update({ chargingOnly })} value={settings.chargingOnly} />
        <Toggle detail="Let Android schedule deferred work and scan foreground changes." label="Automatic sync" onChange={(automaticSync) => update({ automaticSync })} value={settings.automaticSync} />
        <View style={styles.windowRow}>
          <Field keyboard="numeric" label="Start hour" onChange={(value) => update({ windowStart: Math.min(23, Math.max(0, Number(value) || 0)) })} value={String(settings.windowStart)} />
          <Field keyboard="numeric" label="End hour" onChange={(value) => update({ windowEnd: Math.min(24, Math.max(0, Number(value) || 0)) })} value={String(settings.windowEnd)} />
        </View>
        <Pressable disabled={busy} onPress={() => void persist()} style={styles.secondary}><Text style={styles.secondaryText}>Save settings</Text></Pressable>

        <Text style={styles.sectionTitle}>Albums</Text>
        <Text style={styles.detail}>With none selected, automatic sync watches the full camera roll.</Text>
        <View style={styles.chips}>
          {albums.map((album) => (
            <Pressable key={album.id} onPress={() => toggleAlbum(album.id)} style={[styles.chip, settings.albumIds.includes(album.id) && styles.chipSelected]}>
              <Text style={[styles.chipText, settings.albumIds.includes(album.id) && styles.chipTextSelected]}>{album.title} · {album.assetCount}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Manual selection</Text>
        {recent.map((item) => (
          <Pressable key={item.id} onPress={() => toggleMedia(item.id)} style={[styles.mediaRow, selected.has(item.id) && styles.mediaSelected]}>
            <View style={styles.mediaIcon}><Text>{item.mediaType === "video" ? "▶" : "●"}</Text></View>
            <View style={styles.mediaCopy}><Text numberOfLines={1} style={styles.mediaName}>{item.filename}</Text><Text style={styles.detail}>{new Date(item.creationTime).toLocaleString()}</Text></View>
            <Text style={styles.check}>{selected.has(item.id) ? "✓" : ""}</Text>
          </Pressable>
        ))}
        <Pressable disabled={selected.size === 0} onPress={() => void queueSelected()} style={[styles.secondary, selected.size === 0 && styles.disabled]}>
          <Text style={styles.secondaryText}>Queue {selected.size} selected</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07111f" },
  container: { padding: 20, paddingBottom: 64, gap: 12 },
  hero: { paddingVertical: 22, gap: 8 },
  eyebrow: { color: "#2dd4bf", fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  title: { color: "#f8fafc", fontSize: 34, fontWeight: "800", lineHeight: 39 },
  subtitle: { color: "#94a3b8", fontSize: 16, lineHeight: 23 },
  statusCard: { backgroundColor: "#0f1d2e", borderColor: "#1e3349", borderRadius: 18, borderWidth: 1, flexDirection: "row", justifyContent: "space-around", padding: 18 },
  metric: { color: "#f8fafc", fontSize: 24, fontWeight: "800", textAlign: "center" },
  metricLabel: { color: "#94a3b8", fontSize: 12, marginTop: 2 },
  message: { color: "#cbd5e1", minHeight: 20 },
  primary: { alignItems: "center", backgroundColor: "#2dd4bf", borderRadius: 14, minHeight: 52, justifyContent: "center" },
  primaryText: { color: "#042f2e", fontSize: 16, fontWeight: "800" },
  secondary: { alignItems: "center", borderColor: "#2dd4bf", borderRadius: 14, borderWidth: 1, justifyContent: "center", minHeight: 48, marginTop: 4 },
  secondaryText: { color: "#5eead4", fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
  sectionTitle: { color: "#f8fafc", fontSize: 20, fontWeight: "800", marginTop: 22 },
  field: { flex: 1, gap: 6 },
  label: { color: "#94a3b8", fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: "#0f1d2e", borderColor: "#1e3349", borderRadius: 12, borderWidth: 1, color: "#f8fafc", fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  toggleRow: { alignItems: "center", borderBottomColor: "#17283a", borderBottomWidth: 1, flexDirection: "row", paddingVertical: 10 },
  toggleCopy: { flex: 1, paddingRight: 12 },
  toggleLabel: { color: "#e2e8f0", fontSize: 15, fontWeight: "700" },
  detail: { color: "#718096", fontSize: 12, lineHeight: 17 },
  windowRow: { flexDirection: "row", gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#0f1d2e", borderColor: "#1e3349", borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  chipSelected: { backgroundColor: "#134e4a", borderColor: "#2dd4bf" },
  chipText: { color: "#94a3b8", fontSize: 12 },
  chipTextSelected: { color: "#ccfbf1" },
  mediaRow: { alignItems: "center", backgroundColor: "#0f1d2e", borderColor: "#1e3349", borderRadius: 12, borderWidth: 1, flexDirection: "row", padding: 10 },
  mediaSelected: { borderColor: "#2dd4bf" },
  mediaIcon: { alignItems: "center", backgroundColor: "#cbd5e1", borderRadius: 8, height: 38, justifyContent: "center", width: 38 },
  mediaCopy: { flex: 1, marginLeft: 10 },
  mediaName: { color: "#e2e8f0", fontSize: 14, fontWeight: "600" },
  check: { color: "#2dd4bf", fontSize: 20, fontWeight: "800", width: 28, textAlign: "center" },
  pairingCode: { color: "#f8fafc", fontFamily: "monospace", fontSize: 28, fontWeight: "800", letterSpacing: 4, textAlign: "center" },
});

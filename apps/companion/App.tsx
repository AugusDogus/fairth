import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import * as MediaLibrary from "expo-media-library/legacy";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Input } from "heroui-native/input";
import { HeroUINativeProvider } from "heroui-native/provider";
import { Switch } from "heroui-native/switch";
import { Toaster } from "sonner-native";
import { getToken, saveToken } from "./src/credentials";
import { initializeDatabase, loadSettings, saveSettings } from "./src/database";
import { beginEnrollment, completeEnrollment } from "./src/enrollment";
import {
  enqueueChoices,
  listAlbums,
  recentMedia,
  requestMediaAccess,
  type AlbumChoice,
  type MediaChoice,
} from "./src/media";
import "./src/styles.css";
import { configureBackgroundSync, syncCycle, uploadStatus } from "./src/sync";
import type { SyncSettings } from "./src/types";
import { defaultSettings } from "./src/types";

type Counts = Readonly<{ pending: number; retry: number; uploaded: number }>;

type FieldProps = Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  keyboard?: "default" | "numeric";
}>;

function Field({ keyboard = "default", label, onChange, value }: FieldProps) {
  return (
    <View className="flex-1 gap-1.5">
      <Text className="text-xs font-semibold text-muted">{label}</Text>
      <Input
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboard}
        onChangeText={onChange}
        value={value}
      />
    </View>
  );
}

type ToggleProps = Readonly<{
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}>;

function Toggle({ detail, label, onChange, value }: ToggleProps) {
  return (
    <View className="flex-row items-center border-b border-separator/30 py-3">
      <View className="flex-1 pr-3">
        <Text className="text-[15px] font-semibold text-foreground">{label}</Text>
        <Text className="mt-0.5 text-xs leading-4 text-muted">{detail}</Text>
      </View>
      <Switch isSelected={value} onSelectedChange={onChange} />
    </View>
  );
}

function CompanionApp() {
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
    return () => {
      mounted = false;
    };
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
      const enrollmentEndpoint = settings.lanEndpoint.trim().length > 0
        ? settings.lanEndpoint
        : settings.primaryEndpoint;
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
    update({
      albumIds: settings.albumIds.includes(id)
        ? settings.albumIds.filter((value) => value !== id)
        : [...settings.albumIds, id],
    });
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
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pb-16"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-2 py-6">
          <Text className="text-xs font-extrabold tracking-[2px] text-accent">FAIRTH COMPANION</Text>
          <Text className="text-[34px] font-extrabold leading-[39px] text-foreground">
            Your camera roll, queued safely.
          </Text>
          <Text className="text-base leading-6 text-muted">
            LAN first, resumable, and ready to continue when your phone comes back online.
          </Text>
        </View>

        <Card className="flex-row justify-around p-5">
          {([
            [counts.pending, "Queued"],
            [counts.retry, "Retrying"],
            [counts.uploaded, "Uploaded"],
          ] as const).map(([value, label]) => (
            <View key={label} className="items-center">
              <Text className="text-2xl font-extrabold text-surface-foreground">{value}</Text>
              <Text className="mt-0.5 text-xs text-muted">{label}</Text>
            </View>
          ))}
        </Card>
        <Text className="min-h-5 text-sm text-muted">{message}</Text>
        <Button isDisabled={busy} onPress={() => void runSync()} size="lg">
          {busy ? <ActivityIndicator color="#134e4a" /> : <Button.Label>Sync now</Button.Label>}
        </Button>

        <Text className="mt-5 text-xl font-extrabold text-foreground">Connection</Text>
        <Field label="LAN endpoint" onChange={(lanEndpoint) => update({ lanEndpoint })} value={settings.lanEndpoint} />
        <Field label="Remote fallback endpoint" onChange={(primaryEndpoint) => update({ primaryEndpoint })} value={settings.primaryEndpoint} />
        <Field label="Device ID" onChange={(deviceId) => update({ deviceId })} value={settings.deviceId} />
        <Text className="text-xs leading-4 text-muted">
          {enrolled ? "Enrolled with a revocable device session." : "Not enrolled yet."}
        </Text>
        {pairingCode === undefined ? null : (
          <Text className="text-center font-mono text-[28px] font-extrabold tracking-[4px] text-foreground">
            {pairingCode}
          </Text>
        )}
        <Button isDisabled={busy} onPress={() => void enrollDevice()} variant="outline">
          {enrolled ? "Replace device enrollment" : "Enroll this device"}
        </Button>

        <Text className="mt-5 text-xl font-extrabold text-foreground">Sync rules</Text>
        <Toggle detail="Use cellular only when this is off." label="Wi-Fi only" onChange={(wifiOnly) => update({ wifiOnly })} value={settings.wifiOnly} />
        <Toggle detail="Keep queued work until external power is connected." label="Charging only" onChange={(chargingOnly) => update({ chargingOnly })} value={settings.chargingOnly} />
        <Toggle detail="Let Android schedule deferred work and scan foreground changes." label="Automatic sync" onChange={(automaticSync) => update({ automaticSync })} value={settings.automaticSync} />
        <View className="flex-row gap-3">
          <Field keyboard="numeric" label="Start hour" onChange={(value) => update({ windowStart: Math.min(23, Math.max(0, Number(value) || 0)) })} value={String(settings.windowStart)} />
          <Field keyboard="numeric" label="End hour" onChange={(value) => update({ windowEnd: Math.min(24, Math.max(0, Number(value) || 0)) })} value={String(settings.windowEnd)} />
        </View>
        <Button isDisabled={busy} onPress={() => void persist()} variant="outline">Save settings</Button>

        <Text className="mt-5 text-xl font-extrabold text-foreground">Albums</Text>
        <Text className="text-xs leading-4 text-muted">
          With none selected, automatic sync watches the full camera roll.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {albums.map((album) => {
            const isSelected = settings.albumIds.includes(album.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                className={`rounded-full border px-3 py-2 ${isSelected ? "border-accent bg-accent/20" : "border-border bg-surface"}`}
                key={album.id}
                onPress={() => toggleAlbum(album.id)}
              >
                <Text className={`text-xs ${isSelected ? "text-foreground" : "text-muted"}`}>
                  {album.title} · {album.assetCount}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text className="mt-5 text-xl font-extrabold text-foreground">Manual selection</Text>
        {recent.map((item) => {
          const isSelected = selected.has(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              className={`flex-row items-center rounded-xl border bg-surface p-2.5 ${isSelected ? "border-accent" : "border-border"}`}
              key={item.id}
              onPress={() => toggleMedia(item.id)}
            >
              <View className="size-10 items-center justify-center rounded-lg bg-default">
                <Text className="text-default-foreground">{item.mediaType === "video" ? "▶" : "●"}</Text>
              </View>
              <View className="ml-2.5 flex-1">
                <Text className="text-sm font-semibold text-surface-foreground" numberOfLines={1}>{item.filename}</Text>
                <Text className="text-xs leading-4 text-muted">{new Date(item.creationTime).toLocaleString()}</Text>
              </View>
              <Text className="w-7 text-center text-xl font-extrabold text-accent">{isSelected ? "✓" : ""}</Text>
            </Pressable>
          );
        })}
        <Button isDisabled={selected.size === 0} onPress={() => void queueSelected()} variant="outline">
          Queue {selected.size} selected
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView className="flex-1">
      <HeroUINativeProvider>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <CompanionApp />
          <Toaster position="top-center" />
        </SafeAreaProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}

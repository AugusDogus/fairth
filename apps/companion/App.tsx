import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  PermissionsAndroid,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useShareIntent } from "expo-share-intent";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import * as MediaLibrary from "expo-media-library/legacy";
import { getToken, saveToken } from "./src/credentials";
import { initializeDatabase, loadSettings, saveSettings } from "./src/database";
import {
  beginEnrollment,
  completeEnrollment,
  parsePairingScan,
  type EnrollmentChallenge,
  type EnrollmentResult,
} from "./src/enrollment";
import { enqueueSharedImages, hasMediaAccess, requestMediaAccess } from "./src/media";
import { loadApplianceProgress } from "./src/progress";
import { ScannerScreen } from "./src/scanner-screen";
import { sharedImages } from "./src/shared-media";
import {
  ConnectScreen,
  HomeScreen,
  LoadingScreen,
  PairingScreen,
  PermissionScreen,
  PreferencesScreen,
  type ConnectionState,
  type UploadCounts,
} from "./src/screens";
import { checkUploadConnection, configureBackgroundSync, syncCycle, uploadStatus } from "./src/sync";
import type { SyncSettings } from "./src/types";
import { defaultSettings } from "./src/types";

type AppScreen =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "connect"; busy: boolean; error: string | null }>
  | Readonly<{ kind: "scanner"; busy: boolean; error: string | null }>
  | Readonly<{ kind: "pairing"; challenge: EnrollmentChallenge; error: string | null }>
  | Readonly<{ kind: "permission"; busy: boolean; error: string | null }>
  | Readonly<{ kind: "preferences"; busy: boolean; error: string | null }>
  | Readonly<{
      kind: "home";
      busy: boolean;
      connection: ConnectionState;
      counts: UploadCounts;
      notice: string | null;
    }>;

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function enrollmentEndpoints(settings: SyncSettings): readonly string[] {
  const candidates = [settings.primaryEndpoint, defaultSettings.primaryEndpoint];
  return [...new Set(candidates.map((value) => value.trim()).filter((value) => value.length > 0))];
}

async function beginAvailableEnrollment(settings: SyncSettings): Promise<EnrollmentChallenge> {
  for (const endpoint of enrollmentEndpoints(settings)) {
    try {
      return await beginEnrollment(endpoint);
    } catch {
      // Try the next configured route to the same Fairth appliance.
    }
  }
  throw new Error("Fairth could not reach your appliance. Connect this phone to Tailscale or your home Wi-Fi, then try again.");
}

async function counts(settings: SyncSettings): Promise<UploadCounts> {
  const [status, token] = await Promise.all([uploadStatus(), getToken()]);
  const appliance = token === undefined ? undefined : await loadApplianceProgress(settings, token);
  return {
    eligible: status.eligible,
    pending: status.pending,
    retry: status.retry,
    uploaded: status.uploaded,
    ...(appliance === undefined ? {} : { appliance }),
  };
}

async function notificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return true;
  return await PermissionsAndroid.request(permission) === PermissionsAndroid.RESULTS.GRANTED;
}

async function connectionState(): Promise<ConnectionState> {
  try {
    return await checkUploadConnection() ? "connected" : "offline";
  } catch {
    return "offline";
  }
}

function AppFrame({ children, dark = false }: Readonly<{ children: ReactNode; dark?: boolean }>) {
  const backgroundColor = dark ? "#0B1220" : "#F4F6FA";
  return (
    <>
      <StatusBar backgroundColor={backgroundColor} barStyle={dark ? "light-content" : "dark-content"} />
      <SafeAreaView style={{ backgroundColor, flex: 1 }}>{children}</SafeAreaView>
    </>
  );
}

function CompanionApp() {
  const [pendingPairingUri, setPendingPairingUri] = useState<string | null>(null);
  const [settings, setSettings] = useState<SyncSettings>(defaultSettings);
  const [screen, setScreen] = useState<AppScreen>({ kind: "loading" });
  const pairingAttempt = useRef(0);

  useEffect(() => {
    let active = true;
    const receivePairingUri = (url: string | null): void => {
      if (active && url !== null) setPendingPairingUri(url);
    };
    void Linking.getInitialURL().then(receivePairingUri);
    const subscription = Linking.addEventListener("url", ({ url }) => receivePairingUri(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (pendingPairingUri === null || screen.kind !== "connect") return;
    setPendingPairingUri(null);
    void scanPairing(pendingPairingUri);
  }, [pendingPairingUri, screen.kind]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await initializeDatabase();
        const [savedSettings, savedToken, mediaGranted] = await Promise.all([
          loadSettings(),
          getToken(),
          hasMediaAccess(),
        ]);
        if (!mounted) return;
        setSettings(savedSettings);
        if (savedToken === undefined) {
          setScreen({ kind: "connect", busy: false, error: null });
          return;
        }
        if (!mediaGranted) {
          setScreen({ kind: "permission", busy: false, error: null });
          return;
        }
        if (!savedSettings.automaticSync) {
          setScreen({ kind: "preferences", busy: false, error: null });
          return;
        }
        await syncCycle(savedSettings);
        const [savedCounts, connected, notificationsEnabled] = await Promise.all([
          counts(savedSettings),
          connectionState(),
          notificationPermission(),
        ]);
        if (mounted) {
          setScreen({
            kind: "home",
            busy: false,
            connection: connected,
            counts: savedCounts,
            notice: notificationsEnabled
              ? null
              : "Background backup can run, but Android is hiding its upload notification. Enable Fairth notifications in Android settings to see it.",
          });
        }
      } catch (error) {
        if (mounted) {
          setScreen({
            kind: "connect",
            busy: false,
            error: message(error, "Fairth could not finish starting. Try again."),
          });
        }
      }
    })();
    return () => {
      mounted = false;
      pairingAttempt.current += 1;
    };
  }, []);

  useEffect(() => {
    if (screen.kind !== "home") return undefined;
    let active = true;
    let refreshingCounts = false;
    let refreshingConnection = false;
    const refreshCounts = async () => {
      if (refreshingCounts) return;
      refreshingCounts = true;
      try {
        const nextCounts = await counts(settings);
        if (active) {
          setScreen((current) => current.kind === "home" ? { ...current, counts: nextCounts } : current);
        }
      } finally {
        refreshingCounts = false;
      }
    };
    const refreshConnection = async () => {
      if (refreshingConnection) return;
      refreshingConnection = true;
      const connection = await connectionState();
      if (active) {
        setScreen((current) => current.kind === "home" ? { ...current, connection } : current);
      }
      refreshingConnection = false;
    };
    void refreshCounts();
    void refreshConnection();
    const countsTimer = setInterval(() => void refreshCounts(), 2_000);
    const connectionTimer = setInterval(() => void refreshConnection(), 15_000);
    return () => {
      active = false;
      clearInterval(countsTimer);
      clearInterval(connectionTimer);
    };
  }, [screen.kind, settings]);

  useEffect(() => {
    if (!settings.automaticSync || screen.kind !== "home") return undefined;
    const subscription = MediaLibrary.addListener(() => {
      void syncCycle(settings).catch((error: unknown) => {
        setScreen((current) => current.kind === "home"
          ? { ...current, notice: message(error, "Android could not schedule the new media.") }
          : current);
      });
    });
    return () => subscription.remove();
  }, [screen.kind, settings]);

  async function finishEnrollment(challenge: EnrollmentChallenge, attempt: number): Promise<void> {
    let result: EnrollmentResult;
    try {
      result = await completeEnrollment(challenge, settings.deviceId);
    } catch (error) {
      if (pairingAttempt.current === attempt) {
        setScreen({
          kind: "pairing",
          challenge,
          error: message(error, "Fairth lost the connection while waiting for approval. Get a new code and try again."),
        });
      }
      return;
    }
    if (pairingAttempt.current !== attempt) return;
    if (!result.ok) {
      setScreen({ kind: "pairing", challenge, error: result.message });
      return;
    }
    try {
      await saveToken(result.token);
      const nextSettings = { ...settings, primaryEndpoint: challenge.baseUrl };
      await saveSettings(nextSettings);
      setSettings(nextSettings);
      setScreen({ kind: "permission", busy: false, error: null });
    } catch (error) {
      setScreen({
        kind: "pairing",
        challenge,
        error: message(error, "This phone was approved, but Fairth could not save its session. Try again."),
      });
    }
  }

  async function startPairing(): Promise<void> {
    pairingAttempt.current += 1;
    setScreen({ kind: "connect", busy: true, error: null });
    try {
      const challenge = await beginAvailableEnrollment(settings);
      const attempt = pairingAttempt.current;
      setScreen({ kind: "pairing", challenge, error: null });
      void finishEnrollment(challenge, attempt);
    } catch (error) {
      setScreen({ kind: "connect", busy: false, error: message(error, "Fairth could not start pairing. Try again.") });
    }
  }

  async function scanPairing(value: string): Promise<void> {
    const parsed = parsePairingScan(value);
    if (!parsed.ok) {
      setScreen({ kind: "scanner", busy: false, error: parsed.message });
      return;
    }
    pairingAttempt.current += 1;
    const attempt = pairingAttempt.current;
    setScreen({ kind: "scanner", busy: true, error: null });
    let result: EnrollmentResult;
    try {
      result = await completeEnrollment(parsed.redemption, settings.deviceId);
    } catch (error) {
      if (pairingAttempt.current === attempt) {
        setScreen({
          kind: "scanner",
          busy: false,
          error: message(error, "Fairth lost the connection while pairing. Create a new QR code and try again."),
        });
      }
      return;
    }
    if (pairingAttempt.current !== attempt) return;
    if (!result.ok) {
      setScreen({ kind: "scanner", busy: false, error: result.message });
      return;
    }
    try {
      await saveToken(result.token);
      const nextSettings = { ...settings, primaryEndpoint: parsed.redemption.baseUrl };
      await saveSettings(nextSettings);
      setSettings(nextSettings);
      setScreen({ kind: "permission", busy: false, error: null });
    } catch (error) {
      setScreen({
        kind: "scanner",
        busy: false,
        error: message(error, "This phone was paired, but Fairth could not save its session. Create a new QR code and try again."),
      });
    }
  }

  function cancelScanner(): void {
    pairingAttempt.current += 1;
    setScreen({ kind: "connect", busy: false, error: null });
  }

  async function openApproval(): Promise<void> {
    if (screen.kind !== "pairing") return;
    try {
      await Linking.openURL(screen.challenge.verificationUriComplete);
    } catch (error) {
      setScreen({ ...screen, error: message(error, "Android could not open the approval page. Try again.") });
    }
  }

  async function allowPhotos(): Promise<void> {
    setScreen({ kind: "permission", busy: true, error: null });
    try {
      const granted = await requestMediaAccess();
      setScreen(granted
        ? { kind: "preferences", busy: false, error: null }
        : {
            kind: "permission",
            busy: false,
            error: "Photo access is still off. Choose the photos and videos Fairth should back up.",
          });
    } catch (error) {
      setScreen({
        kind: "permission",
        busy: false,
        error: message(error, "Android could not open photo permissions. Try again."),
      });
    }
  }

  function setMobileData(enabled: boolean): void {
    setSettings((current) => ({ ...current, wifiOnly: !enabled }));
  }

  async function startBackup(): Promise<void> {
    setScreen({ kind: "preferences", busy: true, error: null });
    const nextSettings: SyncSettings = {
      ...settings,
      albumIds: [],
      automaticSync: true,
      chargingOnly: false,
      windowEnd: 24,
      windowStart: 0,
    };
    try {
      const notificationsEnabled = await notificationPermission();
      await saveSettings(nextSettings);
      await syncCycle(nextSettings);
      const [nextCounts, connection] = await Promise.all([counts(nextSettings), connectionState()]);
      setSettings(nextSettings);
      setScreen({
        kind: "home",
        busy: false,
        connection,
        counts: nextCounts,
        notice: notificationsEnabled
          ? null
          : "Upload notifications are off. Turn on Fairth notifications in Android settings.",
      });
    } catch (error) {
      setScreen({
        kind: "preferences",
        busy: false,
        error: message(error, "Fairth could not turn on automatic backup. Try again."),
      });
    }
  }

  async function changeHomeMobileData(enabled: boolean): Promise<void> {
    if (screen.kind !== "home") return;
    const previousSettings = settings;
    const nextSettings = { ...settings, wifiOnly: !enabled };
    setSettings(nextSettings);
    try {
      await saveSettings(nextSettings);
      await configureBackgroundSync(nextSettings);
      setScreen({ ...screen, notice: null });
    } catch (error) {
      setSettings(previousSettings);
      setScreen({ ...screen, notice: message(error, "Fairth could not save that setting. Try again.") });
    }
  }

  if (screen.kind === "loading") return <AppFrame><LoadingScreen /></AppFrame>;
  if (screen.kind === "connect") {
    return (
      <AppFrame>
        <ConnectScreen
          busy={screen.busy}
          error={screen.error}
          onManualPairing={() => void startPairing()}
          onScan={() => setScreen({ kind: "scanner", busy: false, error: null })}
        />
      </AppFrame>
    );
  }
  if (screen.kind === "scanner") {
    return (
      <AppFrame dark>
        <ScannerScreen
          busy={screen.busy}
          error={screen.error}
          onCancel={cancelScanner}
          onScan={(value) => void scanPairing(value)}
        />
      </AppFrame>
    );
  }
  if (screen.kind === "pairing") {
    return (
      <AppFrame>
        <PairingScreen
          code={screen.challenge.userCode}
          error={screen.error}
          onOpenApproval={() => void openApproval()}
          onRetry={() => void startPairing()}
        />
      </AppFrame>
    );
  }
  if (screen.kind === "permission") {
    return <AppFrame><PermissionScreen busy={screen.busy} error={screen.error} onAllow={() => void allowPhotos()} /></AppFrame>;
  }
  if (screen.kind === "preferences") {
    return (
      <AppFrame>
        <PreferencesScreen
          busy={screen.busy}
          error={screen.error}
          onChangeMobileData={setMobileData}
          onStart={() => void startBackup()}
          useMobileData={!settings.wifiOnly}
        />
      </AppFrame>
    );
  }
  return (
    <AppFrame>
      <HomeScreen
        connection={screen.connection}
        counts={screen.counts}
        notice={screen.notice}
        onChangeMobileData={(enabled) => void changeHomeMobileData(enabled)}
        useMobileData={!settings.wifiOnly}
      />
    </AppFrame>
  );
}

type ShareReceiverProps = Readonly<{
  files: ReturnType<typeof sharedImages>;
  reset: () => void;
  shareError: string | null;
}>;

type ShareReceiverState =
  | Readonly<{ kind: "working"; message: string }>
  | Readonly<{ kind: "error"; message: string }>;

function ShareReceiver({ files, reset, shareError }: ShareReceiverProps) {
  const processed = useRef<string | undefined>(undefined);
  const [state, setState] = useState<ShareReceiverState>({
    kind: "working",
    message: "Preparing shared photos…",
  });

  useEffect(() => {
    if (shareError !== null) {
      setState({ kind: "error", message: `Fairth could not read the shared photos: ${shareError}` });
      return;
    }
    if (files.length === 0) {
      setState({
        kind: "error",
        message: "Fairth did not receive a readable photo. Your existing queue is unchanged.",
      });
      return;
    }
    const signature = files.map((file) => `${file.path}\u0000${file.size ?? ""}`).join("\u0001");
    if (processed.current === signature) return;
    processed.current = signature;

    void (async () => {
      try {
        setState({
          kind: "working",
          message: `Queueing ${files.length} shared photo${files.length === 1 ? "" : "s"}…`,
        });
        const queued = await enqueueSharedImages(files);
        if (queued === 0) {
          setState({
            kind: "error",
            message: "Fairth could not add the shared photos. Your existing queue is unchanged.",
          });
          return;
        }
        reset();
        BackHandler.exitApp();
      } catch (error) {
        setState({
          kind: "error",
          message: message(
            error,
            "Fairth could not queue the shared photos. Your existing queue is unchanged.",
          ),
        });
      }
    })();
  }, [files, reset, shareError]);

  return (
    <AppFrame>
      <View style={styles.shareReceiver}>
        {state.kind === "working" ? <ActivityIndicator color="#3157E8" size="large" /> : null}
        <Text style={styles.shareMessage}>{state.message}</Text>
      </View>
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  shareMessage: {
    color: "#64748B",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 20,
    textAlign: "center",
  },
  shareReceiver: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
});

export default function App() {
  const share = useShareIntent({ resetOnBackground: false });
  const receivedFiles = sharedImages(share.shareIntent.files);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {share.hasShareIntent || share.error !== null ? (
          <ShareReceiver files={receivedFiles} reset={share.resetShareIntent} shareError={share.error} />
        ) : (
          <CompanionApp />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

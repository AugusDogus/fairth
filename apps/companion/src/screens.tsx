import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { summarizeImports, type ApplianceProgress } from "./progress";

export type UploadCounts = Readonly<{
  eligible: number;
  pending: number;
  retry: number;
  uploaded: number;
  appliance?: ApplianceProgress;
}>;

export type ConnectionState = "checking" | "connected" | "offline";

type ScreenShellProps = Readonly<{
  children: ReactNode;
  step?: 1 | 2 | 3;
}>;

type ButtonProps = Readonly<{
  busy?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onPress: () => void;
}>;

type ErrorMessageProps = Readonly<{ message: string | null }>;

const color = {
  background: "#F4F6FA",
  surface: "#FFFFFF",
  ink: "#101828",
  body: "#344054",
  muted: "#667085",
  border: "#D0D5DD",
  borderSoft: "#E4E7EC",
  primary: "#3157E8",
  primaryPressed: "#2443B8",
  primarySoft: "#EEF2FF",
  hero: "#18285A",
  heroMuted: "#D7DDF1",
  success: "#067647",
  successSoft: "#ECFDF3",
  error: "#B42318",
  errorSoft: "#FEF3F2",
  white: "#FFFFFF",
} as const;

function FairthMark({ inverse = false }: Readonly<{ inverse?: boolean }>) {
  return (
    <View style={[styles.mark, inverse ? styles.markInverse : undefined]}>
      <Svg height={22} viewBox="0 0 24 24" width={22}>
        <Path
          d="M7.3 18.25h9.35a4.1 4.1 0 0 0 .62-8.15A5.75 5.75 0 0 0 6.2 8.55a4.85 4.85 0 0 0 1.1 9.7Z"
          fill="none"
          stroke={inverse ? color.hero : color.white}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
        <Path
          d="m9.25 12.2 2.75-2.75 2.75 2.75M12 9.7v5.5"
          fill="none"
          stroke={inverse ? color.hero : color.white}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
      </Svg>
    </View>
  );
}

function Brand() {
  return (
    <View style={styles.brand}>
      <FairthMark />
      <Text style={styles.brandName}>Fairth</Text>
    </View>
  );
}

function StepIndicator({ step }: Readonly<{ step: 1 | 2 | 3 }>) {
  return (
    <View accessibilityLabel={`Setup step ${step} of 3`} style={styles.steps}>
      {[1, 2, 3].map((value) => (
        <View key={value} style={[styles.step, value <= step ? styles.stepActive : undefined]} />
      ))}
    </View>
  );
}

function ScreenShell({ children, step }: ScreenShellProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {step === undefined ? null : (
        <View style={styles.screenTop}>
          <Brand />
          <StepIndicator step={step} />
        </View>
      )}
      {children}
    </ScrollView>
  );
}

function PrimaryButton({ busy = false, children, disabled = false, onPress }: ButtonProps) {
  const blocked = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        blocked ? styles.buttonDisabled : undefined,
        pressed && !blocked ? styles.primaryButtonPressed : undefined,
      ]}
    >
      {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.primaryButtonText}>{children}</Text>}
    </Pressable>
  );
}

function SecondaryButton({ busy = false, children, disabled = false, onPress }: ButtonProps) {
  const blocked = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        blocked ? styles.buttonDisabled : undefined,
        pressed && !blocked ? styles.secondaryButtonPressed : undefined,
      ]}
    >
      {busy ? <ActivityIndicator color={color.primary} /> : <Text style={styles.secondaryButtonText}>{children}</Text>}
    </Pressable>
  );
}

function ErrorMessage({ message }: ErrorMessageProps) {
  if (message === null) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function SetupRow({
  body,
  number,
  title,
}: Readonly<{ body: string; number: number; title: string }>) {
  return (
    <View style={styles.setupRow}>
      <View style={styles.setupNumber}>
        <Text style={styles.setupNumberText}>{number}</Text>
      </View>
      <View style={styles.flexOne}>
        <Text style={styles.setupTitle}>{title}</Text>
        <Text style={styles.setupBody}>{body}</Text>
      </View>
    </View>
  );
}

export function LoadingScreen() {
  return (
    <View style={styles.loadingScreen}>
      <FairthMark />
      <ActivityIndicator color={color.primary} size="small" />
    </View>
  );
}

export type ConnectScreenProps = Readonly<{
  busy: boolean;
  error: string | null;
  onManualPairing: () => void;
  onScan: () => void;
}>;

export function ConnectScreen({ busy, error, onManualPairing, onScan }: ConnectScreenProps) {
  return (
    <ScreenShell step={1}>
      <Text style={styles.title}>Set up this phone.</Text>
      <Text style={styles.description}>
        Fairth will guide you through the three required steps.
      </Text>

      <View style={styles.setupCard}>
        <SetupRow
          body="Open Fairth onboarding on a signed-in computer."
          number={1}
          title="Scan the pairing QR code"
        />
        <View style={styles.setupDivider} />
        <SetupRow
          body="Choose which photos and videos Fairth may read."
          number={2}
          title="Allow photo access"
        />
        <View style={styles.setupDivider} />
        <SetupRow
          body="Use Wi-Fi only by default, or allow mobile data."
          number={3}
          title="Turn on backup"
        />
      </View>

      <ErrorMessage message={error} />
      <View style={styles.bottomAction}>
        <PrimaryButton disabled={busy} onPress={onScan}>Scan QR code</PrimaryButton>
        <SecondaryButton busy={busy} onPress={onManualPairing}>Approve in browser instead</SecondaryButton>
        <Text style={styles.actionNote}>Nothing uploads until setup is complete.</Text>
      </View>
    </ScreenShell>
  );
}

export type PairingScreenProps = Readonly<{
  code: string;
  error: string | null;
  onOpenApproval: () => void;
  onRetry: () => void;
}>;

function readableCode(value: string): string {
  const normalized = value.replaceAll(/[^A-Z0-9]/gi, "").toUpperCase();
  const midpoint = Math.ceil(normalized.length / 2);
  return `${normalized.slice(0, midpoint)} ${normalized.slice(midpoint)}`.trim();
}

export function PairingScreen({ code, error, onOpenApproval, onRetry }: PairingScreenProps) {
  return (
    <ScreenShell step={1}>
      <Text style={styles.title}>Approve the connection.</Text>
      <Text style={styles.description}>
        Open Fairth, sign in if asked, and confirm that the code matches.
      </Text>

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Device code</Text>
        <Text accessibilityLabel={`Device code ${code}`} selectable style={styles.code}>{readableCode(code)}</Text>
        {error === null ? (
          <View style={styles.waitingRow}>
            <ActivityIndicator color={color.primary} size="small" />
            <Text style={styles.waitingText}>Waiting for approval</Text>
          </View>
        ) : null}
      </View>

      <ErrorMessage message={error} />
      <View style={styles.bottomAction}>
        <PrimaryButton onPress={onOpenApproval}>Open approval page</PrimaryButton>
        {error === null ? null : <SecondaryButton onPress={onRetry}>Get a new code</SecondaryButton>}
        <Text style={styles.actionNote}>The code expires after 30 minutes.</Text>
      </View>
    </ScreenShell>
  );
}

export type PermissionScreenProps = Readonly<{
  busy: boolean;
  error: string | null;
  onAllow: () => void;
}>;

export function PermissionScreen({ busy, error, onAllow }: PermissionScreenProps) {
  return (
    <ScreenShell step={2}>
      <View style={styles.photoStack}>
        <View style={[styles.photoTile, styles.photoTileBack]} />
        <View style={[styles.photoTile, styles.photoTileMiddle]} />
        <View style={styles.photoTileFront}>
          <View style={styles.photoSun} />
          <View style={styles.photoMountain} />
        </View>
      </View>
      <Text style={styles.title}>Choose what Fairth can see.</Text>
      <Text style={styles.description}>
        Android will ask which photos and videos Fairth may back up, then allow Fairth to preserve their original location and metadata.
      </Text>

      <View style={styles.privacyNote}>
        <Text style={styles.privacyTitle}>Your library stays yours</Text>
        <Text style={styles.privacyBody}>
          Fairth reads the original file without editing or deleting it. Access can be changed anytime in Android settings.
        </Text>
      </View>

      <ErrorMessage message={error} />
      <View style={styles.bottomAction}>
        <PrimaryButton busy={busy} onPress={onAllow}>Choose photos &amp; videos</PrimaryButton>
      </View>
    </ScreenShell>
  );
}

export type PreferencesScreenProps = Readonly<{
  busy: boolean;
  error: string | null;
  onChangeMobileData: (enabled: boolean) => void;
  onStart: () => void;
  useMobileData: boolean;
}>;

export function PreferencesScreen({
  busy,
  error,
  onChangeMobileData,
  onStart,
  useMobileData,
}: PreferencesScreenProps) {
  return (
    <ScreenShell step={3}>
      <Text style={styles.title}>Ready when you are.</Text>
      <Text style={styles.description}>
        Fairth will watch DCIM/Camera and continue backups in the background.
      </Text>

      <View style={styles.preferenceList}>
        <View style={styles.summaryRow}>
          <View style={styles.selectionIcon}>
            <Text style={styles.selectionGlyph}>✓</Text>
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.selectionTitle}>DCIM/Camera</Text>
            <Text style={styles.selectionBody}>Only camera photos and videos</Text>
          </View>
        </View>
        <View style={styles.cardDivider} />
        <View style={styles.summaryRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>Use mobile data</Text>
            <Text style={styles.settingBody}>Off by default. Backups wait for Wi-Fi.</Text>
          </View>
          <Switch
            accessibilityLabel="Use mobile data"
            onValueChange={onChangeMobileData}
            thumbColor={color.white}
            trackColor={{ false: color.border, true: color.primary }}
            value={useMobileData}
          />
        </View>
      </View>

      <ErrorMessage message={error} />
      <View style={styles.bottomAction}>
        <PrimaryButton busy={busy} onPress={onStart}>Start backing up</PrimaryButton>
        <Text style={styles.actionNote}>Android controls exact background timing to protect battery life.</Text>
      </View>
    </ScreenShell>
  );
}

export type HomeScreenProps = Readonly<{
  connection: ConnectionState;
  counts: UploadCounts;
  notice: string | null;
  onChangeMobileData: (enabled: boolean) => void;
  useMobileData: boolean;
}>;

function ProgressTrack({ current, label, total }: Readonly<{ current: number; label: string; total: number }>) {
  const completed = Math.min(Math.max(current, 0), total);
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{ max: total, min: 0, now: completed }}
      style={styles.stageProgressTrack}
    >
      {total === 0 ? null : (
        <>
          <View style={[styles.stageProgressFill, { flexGrow: completed }]} />
          <View style={{ flexGrow: Math.max(total - completed, 0) }} />
        </>
      )}
    </View>
  );
}

function CameraMark() {
  return (
    <View style={styles.sourceIcon}>
      <Svg height={24} viewBox="0 0 24 24" width={24}>
        <Path
          d="M4.5 6.5h15a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V8a1.5 1.5 0 0 1 1.5-1.5Z"
          fill="none"
          stroke={color.primary}
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
        <Path
          d="m6.5 16 3.2-3.2 2.4 2.4 2.7-3.4 2.7 4.2M8.5 10.2h.01"
          fill="none"
          stroke={color.primary}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
      </Svg>
    </View>
  );
}

function GooglePhotosMark() {
  return (
    <View style={styles.googlePhotosIcon}>
      <Svg height={28} viewBox="0 0 24 24" width={28}>
        <Path d="M12 2a5 5 0 0 0-5 5v5h5V2Z" fill="#EA4335" />
        <Path d="M22 12a5 5 0 0 0-5-5h-5v5h10Z" fill="#FBBC04" />
        <Path d="M12 22a5 5 0 0 0 5-5v-5h-5v10Z" fill="#34A853" />
        <Path d="M2 12a5 5 0 0 0 5 5h5v-5H2Z" fill="#4285F4" />
      </Svg>
    </View>
  );
}

function MobileDataMark() {
  return (
    <View style={styles.sourceIcon}>
      <Svg height={24} viewBox="0 0 24 24" width={24}>
        <Path
          d="M5 19v-3M9.5 19v-6M14 19v-9M18.5 19V7"
          fill="none"
          stroke={color.primary}
          strokeLinecap="round"
          strokeWidth={2.2}
        />
      </Svg>
    </View>
  );
}

function StateMark({ kind, large = false }: Readonly<{ kind: "active" | "complete" | "warning"; large?: boolean }>) {
  const warning = kind === "warning";
  const active = kind === "active";
  return (
    <View
      style={[
        styles.stateMark,
        warning ? styles.stateMarkWarning : active ? styles.stateMarkActive : styles.stateMarkComplete,
        large ? styles.stateMarkLarge : undefined,
      ]}
    >
      <Svg height={large ? 24 : 14} viewBox="0 0 24 24" width={large ? 24 : 14}>
        <Path
          d={warning ? "M12 7.5v5.25M12 16.5h.01" : active ? "M12 17V7m-4 4 4-4 4 4" : "m6.5 12.5 3.4 3.4 7.6-8"}
          fill="none"
          stroke={warning ? color.error : active ? color.primary : color.success}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={large ? 2.2 : 2.5}
        />
      </Svg>
    </View>
  );
}

export function HomeScreen({
  connection,
  counts,
  notice,
  onChangeMobileData,
  useMobileData,
}: HomeScreenProps) {
  const waiting = counts.pending + counts.retry;
  const total = Math.max(counts.eligible, counts.uploaded + waiting);
  const uploaded = Math.min(counts.uploaded, total);
  const remaining = Math.max(total - uploaded, waiting);
  const title = total === 0
    ? "Up to date"
    : remaining === 0
      ? "Backed up"
      : `${remaining.toLocaleString()} ${remaining === 1 ? "item" : "items"} left`;
  const description = total === 0
    ? "Camera backup is on"
    : remaining === 0
      ? `${uploaded.toLocaleString()} camera ${uploaded === 1 ? "item" : "items"} in Fairth`
    : connection === "connected"
      ? `${uploaded.toLocaleString()} of ${total.toLocaleString()} backed up`
      : connection === "checking"
        ? "Checking the connection"
        : "Waiting to reconnect";
  const connectionLabel = connection === "connected" ? "Connected" : connection === "checking" ? "Checking" : "Offline";
  const appliance = counts.appliance;
  const imports = appliance === undefined ? undefined : summarizeImports(appliance.imports);
  const photos = appliance?.googlePhotos;
  const photosHasProgress = photos?.state === "uploading" && photos.completed !== undefined && photos.total !== undefined;
  const photosWarning = photos?.state === "blocked" || photos?.state === "needs_setup" || (imports?.failed ?? 0) > 0;
  const photosBusy = !photosWarning && ((imports?.pending ?? 0) > 0 || photos?.state === "uploading");
  const photosWarningDetail = (imports?.failed ?? 0) > 0
    ? `${imports?.failed.toLocaleString()} ${imports?.failed === 1 ? "item could" : "items could"} not be prepared for Google Photos.`
    : photos?.state === "blocked" || photos?.state === "needs_setup"
      ? photos.detail
      : undefined;
  const photosSummary = photosWarning
    ? photos?.state === "needs_setup"
      ? "Needs setup"
      : "Needs attention"
    : (imports?.pending ?? 0) > 0
      ? `Preparing ${imports?.pending.toLocaleString()} ${imports?.pending === 1 ? "item" : "items"}`
      : photos?.state === "uploading"
        ? photos.remaining === undefined
          ? "Backing up"
          : `${photos.remaining.toLocaleString()} ${photos.remaining === 1 ? "item" : "items"} left`
        : photos?.state === "idle"
          ? "Backup on"
          : "Checking";
  const cameraSummary = total === 0
    ? "Watching DCIM/Camera"
    : remaining === 0
      ? `${uploaded.toLocaleString()} backed up`
      : `${remaining.toLocaleString()} ${remaining === 1 ? "item" : "items"} left`;

  return (
    <ScreenShell>
      <View style={styles.homeHeader}>
        <Brand />
        <View style={[styles.connectionBadge, connection === "connected" ? styles.connectedBadge : styles.offlineBadge]}>
          <View style={[styles.connectionDot, connection === "connected" ? styles.connectedDot : styles.offlineDot]} />
          <Text style={[styles.connectionText, connection === "connected" ? styles.connectedText : styles.offlineText]}>
            {connectionLabel}
          </Text>
        </View>
      </View>

      <View style={styles.overview}>
        <View style={styles.overviewCopyRow}>
          <StateMark kind={remaining === 0 ? "complete" : "active"} large />
          <View style={styles.flexOne}>
            <Text style={styles.overviewTitle}>{title}</Text>
            <Text style={styles.overviewBody}>{description}</Text>
          </View>
        </View>
        {remaining > 0 && total > 0 ? (
          <ProgressTrack current={uploaded} label={`${uploaded} of ${total} camera items backed up`} total={total} />
        ) : null}
      </View>

      {notice === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      <View style={styles.homeSection}>
        <Text style={styles.sectionTitle}>Backup</Text>
        <View style={styles.statusList}>
          <View accessibilityLabel={`Camera, ${cameraSummary}`} style={styles.statusRow}>
            <CameraMark />
            <View style={styles.flexOne}>
              <Text style={styles.rowTitle}>Camera</Text>
              <Text style={styles.rowBody}>{cameraSummary}</Text>
            </View>
            {remaining === 0 ? <StateMark kind="complete" /> : null}
          </View>
          <View style={styles.rowDivider} />
          <View accessibilityLabel={`Google Photos, ${photosSummary}`} style={styles.statusRow}>
            <GooglePhotosMark />
            <View style={styles.flexOne}>
              <Text style={styles.rowTitle}>Google Photos</Text>
              <Text style={[styles.rowBody, photosWarning ? styles.rowBodyWarning : undefined]}>{photosSummary}</Text>
              {photosWarningDetail === undefined ? null : <Text style={styles.warningDetail}>{photosWarningDetail}</Text>}
            </View>
            {photosWarning ? (
              <StateMark kind="warning" />
            ) : photosBusy ? (
              <ActivityIndicator color={color.primary} size="small" />
            ) : photos?.state === "idle" ? (
              <StateMark kind="complete" />
            ) : null}
          </View>
          {photosHasProgress ? (
            <View style={styles.rowProgress}>
              <ProgressTrack current={photos.completed} label={`Google Photos: ${photos.completed} of ${photos.total}`} total={photos.total} />
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.homeSection}>
        <Text style={styles.sectionTitle}>Network</Text>
        <View style={styles.statusList}>
          <View style={styles.statusRow}>
            <MobileDataMark />
            <View style={styles.settingCopy}>
              <Text style={styles.rowTitle}>Mobile data</Text>
              <Text style={styles.rowBody}>{useMobileData ? "Wi-Fi and mobile data" : "Wi-Fi only"}</Text>
            </View>
            <Switch
              accessibilityLabel="Use mobile data"
              onValueChange={onChangeMobileData}
              thumbColor={color.white}
              trackColor={{ false: color.border, true: color.primary }}
              value={useMobileData}
            />
          </View>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  actionNote: { color: color.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  bottomAction: { gap: 12, marginTop: "auto", paddingTop: 28 },
  brand: { alignItems: "center", flexDirection: "row", gap: 10 },
  brandName: { color: color.ink, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  buttonDisabled: { opacity: 0.55 },
  cardDivider: { backgroundColor: color.borderSoft, height: StyleSheet.hairlineWidth, marginLeft: 58 },
  code: { color: color.ink, fontSize: 35, fontVariant: ["tabular-nums"], fontWeight: "800", letterSpacing: 3, marginTop: 12 },
  codeCard: { alignItems: "center", backgroundColor: color.surface, borderColor: color.borderSoft, borderRadius: 22, borderWidth: 1, marginTop: 30, paddingHorizontal: 20, paddingVertical: 28 },
  codeLabel: { color: color.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  connectionBadge: { alignItems: "center", flexDirection: "row", gap: 7 },
  connectedBadge: { backgroundColor: "transparent" },
  connectionDot: { borderRadius: 99, height: 7, width: 7 },
  connectedDot: { backgroundColor: color.success, borderRadius: 99, height: 7, width: 7 },
  connectionText: { fontSize: 12, fontWeight: "800" },
  connectedText: { color: color.success, fontSize: 12, fontWeight: "800" },
  description: { color: color.body, fontSize: 17, lineHeight: 26, marginTop: 14 },
  errorBox: { backgroundColor: color.errorSoft, borderRadius: 14, marginTop: 18, paddingHorizontal: 15, paddingVertical: 13 },
  errorText: { color: color.error, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  flexOne: { flex: 1 },
  googlePhotosIcon: { alignItems: "center", height: 42, justifyContent: "center", width: 42 },
  homeHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 46 },
  homeSection: { marginTop: 30 },
  loadingScreen: { alignItems: "center", backgroundColor: color.background, flex: 1, gap: 18, justifyContent: "center" },
  mark: { alignItems: "center", backgroundColor: color.primary, borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  markInverse: { backgroundColor: color.white },
  noticeBox: { backgroundColor: color.primarySoft, borderRadius: 14, marginTop: 14, paddingHorizontal: 15, paddingVertical: 13 },
  noticeText: { color: color.hero, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  offlineBadge: { backgroundColor: "transparent" },
  offlineDot: { backgroundColor: "#B54708" },
  offlineText: { color: "#934A0A" },
  overview: { borderBottomColor: color.borderSoft, borderBottomWidth: StyleSheet.hairlineWidth, gap: 22, marginTop: 34, paddingBottom: 32 },
  overviewBody: { color: color.body, fontSize: 15, lineHeight: 21, marginTop: 3 },
  overviewCopyRow: { alignItems: "center", flexDirection: "row", gap: 15 },
  overviewTitle: { color: color.ink, fontSize: 32, fontWeight: "800", letterSpacing: -0.8, lineHeight: 38 },
  photoMountain: { backgroundColor: color.primary, bottom: -14, height: 52, left: 8, position: "absolute", transform: [{ rotate: "42deg" }], width: 52 },
  photoStack: { height: 132, marginTop: 18, width: 146 },
  photoSun: { backgroundColor: "#FDB022", borderRadius: 99, height: 20, position: "absolute", right: 18, top: 18, width: 20 },
  photoTile: { backgroundColor: color.surface, borderColor: color.border, borderRadius: 18, borderWidth: 1, height: 104, left: 20, position: "absolute", top: 14, width: 112 },
  photoTileBack: { transform: [{ rotate: "-10deg" }, { translateX: -8 }] },
  photoTileFront: { backgroundColor: color.primarySoft, borderColor: color.primary, borderRadius: 18, borderWidth: 2, height: 104, left: 20, overflow: "hidden", position: "absolute", top: 14, width: 112 },
  photoTileMiddle: { transform: [{ rotate: "8deg" }, { translateX: 8 }] },
  preferenceList: { borderBottomColor: color.borderSoft, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: color.borderSoft, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 28 },
  primaryButton: { alignItems: "center", backgroundColor: color.primary, borderRadius: 16, height: 56, justifyContent: "center", paddingHorizontal: 20 },
  primaryButtonPressed: { backgroundColor: color.primaryPressed, transform: [{ scale: 0.98 }] },
  primaryButtonText: { color: color.white, fontSize: 16, fontWeight: "800" },
  privacyBody: { color: color.body, fontSize: 14, lineHeight: 21, marginTop: 5 },
  privacyNote: { borderLeftColor: color.primary, borderLeftWidth: 3, marginTop: 28, paddingLeft: 16, paddingVertical: 2 },
  privacyTitle: { color: color.ink, fontSize: 15, fontWeight: "800" },
  rowBody: { color: color.muted, fontSize: 14, lineHeight: 20, marginTop: 2 },
  rowBodyWarning: { color: color.error },
  rowDivider: { backgroundColor: color.borderSoft, height: StyleSheet.hairlineWidth, marginLeft: 56 },
  rowProgress: { paddingBottom: 16, paddingLeft: 56 },
  rowTitle: { color: color.ink, fontSize: 16, fontWeight: "700" },
  screenContent: { backgroundColor: color.background, flexGrow: 1, paddingBottom: 28, paddingHorizontal: 22, paddingTop: 14 },
  screenTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 46 },
  sectionTitle: { color: color.ink, fontSize: 18, fontWeight: "800", letterSpacing: -0.2, marginBottom: 9 },
  secondaryButton: { alignItems: "center", backgroundColor: color.surface, borderColor: color.border, borderRadius: 16, borderWidth: 1, height: 54, justifyContent: "center", paddingHorizontal: 20 },
  secondaryButtonPressed: { backgroundColor: color.primarySoft, transform: [{ scale: 0.98 }] },
  secondaryButtonText: { color: color.primary, fontSize: 15, fontWeight: "800" },
  selectionBody: { color: color.body, fontSize: 14, lineHeight: 20, marginTop: 3 },
  selectionGlyph: { color: color.white, fontSize: 15, fontWeight: "900" },
  selectionIcon: { alignItems: "center", backgroundColor: color.primary, borderRadius: 99, height: 32, justifyContent: "center", width: 32 },
  selectionTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  settingBody: { color: color.body, fontSize: 13, lineHeight: 19, marginTop: 3 },
  settingCopy: { flex: 1, paddingRight: 14 },
  settingTitle: { color: color.ink, fontSize: 15, fontWeight: "800" },
  setupBody: { color: color.body, fontSize: 13, lineHeight: 19, marginTop: 3 },
  setupCard: { borderBottomColor: color.borderSoft, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: color.borderSoft, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 28, paddingHorizontal: 2 },
  setupDivider: { backgroundColor: color.borderSoft, height: StyleSheet.hairlineWidth, marginLeft: 46 },
  setupNumber: { alignItems: "center", backgroundColor: color.primarySoft, borderRadius: 99, height: 30, justifyContent: "center", width: 30 },
  setupNumberText: { color: color.primary, fontSize: 13, fontWeight: "900" },
  setupRow: { alignItems: "center", flexDirection: "row", gap: 14, paddingVertical: 16 },
  setupTitle: { color: color.ink, fontSize: 15, fontWeight: "800" },
  sourceIcon: { alignItems: "center", backgroundColor: color.primarySoft, borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  stateMark: { alignItems: "center", borderRadius: 99, height: 26, justifyContent: "center", width: 26 },
  stateMarkActive: { backgroundColor: color.primarySoft },
  stateMarkComplete: { backgroundColor: color.successSoft },
  stateMarkLarge: { height: 48, width: 48 },
  stateMarkWarning: { backgroundColor: color.errorSoft },
  statusList: { borderBottomColor: color.borderSoft, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: color.borderSoft, borderTopWidth: StyleSheet.hairlineWidth },
  statusRow: { alignItems: "center", flexDirection: "row", gap: 14, minHeight: 76, paddingVertical: 14 },
  stageProgressFill: { backgroundColor: color.primary, borderRadius: 99 },
  stageProgressTrack: { backgroundColor: color.primarySoft, borderRadius: 99, flexDirection: "row", height: 6, overflow: "hidden" },
  step: { backgroundColor: color.border, borderRadius: 99, height: 5, width: 22 },
  stepActive: { backgroundColor: color.primary, width: 30 },
  steps: { flexDirection: "row", gap: 6 },
  summaryRow: { alignItems: "center", flexDirection: "row", gap: 14, padding: 17 },
  title: { color: color.ink, fontSize: 36, fontWeight: "800", letterSpacing: -1.2, lineHeight: 42, marginTop: 28 },
  waitingRow: { alignItems: "center", backgroundColor: color.primarySoft, borderRadius: 99, flexDirection: "row", gap: 9, marginTop: 24, paddingHorizontal: 13, paddingVertical: 8 },
  waitingText: { color: color.primary, fontSize: 12, fontWeight: "800" },
  warningDetail: { color: color.body, fontSize: 13, lineHeight: 18, marginTop: 5, paddingRight: 10 },
});

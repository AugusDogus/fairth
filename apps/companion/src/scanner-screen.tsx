import { useEffect, useState } from "react";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type ScannerScreenProps = Readonly<{
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onScan: (value: string) => void;
}>;

export function ScannerScreen({ busy, error, onCancel, onScan }: ScannerScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [scanPaused, setScanPaused] = useState(false);

  useEffect(() => {
    if (busy) setScanPaused(true);
  }, [busy]);

  function handleScan(result: BarcodeScanningResult): void {
    if (scanPaused) return;
    setScanPaused(true);
    onScan(result.data);
  }

  async function allowCamera(): Promise<void> {
    setPermissionError(null);
    try {
      const result = await requestPermission();
      if (!result.granted) {
        setPermissionError("Camera access is still off. Allow it to scan the pairing QR code.");
      }
    } catch {
      setPermissionError("Android could not open camera permissions. Try again.");
    }
  }

  if (permission === null) {
    return (
      <View style={styles.permissionScreen}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <Text style={styles.permissionTitle}>Scan the pairing code.</Text>
        <Text style={styles.permissionBody}>Fairth needs camera access only to read the QR code shown on onboarding.</Text>
        {permissionError === null ? null : <Text style={styles.permissionError}>{permissionError}</Text>}
        <View style={styles.permissionActions}>
          {permission.canAskAgain ? (
            <Pressable onPress={() => void allowCamera()} style={styles.lightButton}>
              <Text style={styles.lightButtonText}>Allow camera access</Text>
            </Pressable>
          ) : (
            <Text style={styles.permissionError}>Enable Camera for Fairth in Android settings, then return here.</Text>
          )}
          <Pressable onPress={onCancel} style={styles.darkButton}>
            <Text style={styles.darkButtonText}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        facing="back"
        onBarcodeScanned={busy || scanPaused ? undefined : handleScan}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.shade} />
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.closeButton}>
          <Text style={styles.closeGlyph}>×</Text>
        </Pressable>
        <Text style={styles.topTitle}>Scan QR code</Text>
        <View style={styles.topSpacer} />
      </View>
      <View pointerEvents="none" style={styles.frame} />
      <View style={styles.instructionCard}>
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#3157E8" />
            <View style={styles.flexOne}>
              <Text style={styles.instructionTitle}>Pairing this phone</Text>
              <Text style={styles.instructionBody}>Keep Fairth open for a moment.</Text>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.instructionTitle}>Point the camera at onboarding</Text>
            <Text style={styles.instructionBody}>Place the entire Fairth QR code inside the frame.</Text>
            {error === null ? null : (
              <>
                <Text style={styles.scanError}>{error}</Text>
                <Pressable
                  onPress={() => setScanPaused(false)}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryButtonText}>Scan again</Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  busyRow: { alignItems: "center", flexDirection: "row", gap: 14 },
  closeButton: { alignItems: "center", backgroundColor: "rgba(11,18,32,0.68)", borderRadius: 99, height: 42, justifyContent: "center", width: 42 },
  closeGlyph: { color: "#FFFFFF", fontSize: 28, fontWeight: "400", lineHeight: 30 },
  darkButton: { alignItems: "center", borderColor: "#475467", borderRadius: 14, borderWidth: 1, height: 52, justifyContent: "center" },
  darkButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  flexOne: { flex: 1 },
  frame: { alignSelf: "center", borderColor: "#FFFFFF", borderRadius: 24, borderWidth: 3, height: 252, marginTop: 112, width: 252 },
  instructionBody: { color: "#475467", fontSize: 14, lineHeight: 20, marginTop: 4 },
  instructionCard: { backgroundColor: "#FFFFFF", borderRadius: 22, bottom: 22, left: 18, padding: 20, position: "absolute", right: 18 },
  instructionTitle: { color: "#101828", fontSize: 17, fontWeight: "800" },
  lightButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, height: 54, justifyContent: "center" },
  lightButtonText: { color: "#101828", fontSize: 15, fontWeight: "800" },
  permissionActions: { gap: 12, marginTop: 28 },
  permissionBody: { color: "#D0D5DD", fontSize: 16, lineHeight: 24, marginTop: 14 },
  permissionError: { color: "#FDA29B", fontSize: 14, lineHeight: 20, marginTop: 16 },
  permissionScreen: { backgroundColor: "#0B1220", flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  permissionTitle: { color: "#FFFFFF", fontSize: 34, fontWeight: "800", letterSpacing: -1, lineHeight: 40, marginTop: 10 },
  retryButton: { alignItems: "center", backgroundColor: "#EEF2FF", borderRadius: 12, height: 44, justifyContent: "center", marginTop: 14 },
  retryButtonText: { color: "#3157E8", fontSize: 14, fontWeight: "800" },
  scanError: { color: "#B42318", fontSize: 13, fontWeight: "600", lineHeight: 19, marginTop: 12 },
  screen: { backgroundColor: "#0B1220", flex: 1 },
  shade: { backgroundColor: "rgba(11,18,32,0.28)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", left: 18, position: "absolute", right: 18, top: 14 },
  topSpacer: { width: 42 },
  topTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
});

export type SyncSettings = Readonly<{
  primaryEndpoint: string;
  lanEndpoint: string;
  deviceId: string;
  wifiOnly: boolean;
  chargingOnly: boolean;
  automaticSync: boolean;
  windowStart: number;
  windowEnd: number;
  albumIds: readonly string[];
}>;

export const defaultSettings: SyncSettings = {
  primaryEndpoint: process.env.EXPO_PUBLIC_FAIRTH_PRIMARY_ENDPOINT?.trim() ?? "",
  lanEndpoint: "",
  deviceId: "pixel",
  wifiOnly: true,
  chargingOnly: false,
  automaticSync: false,
  windowStart: 0,
  windowEnd: 24,
  albumIds: [],
};

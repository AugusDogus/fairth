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
  primaryEndpoint: "",
  lanEndpoint: "http://unraid.local:3000",
  deviceId: "pixel",
  wifiOnly: true,
  chargingOnly: false,
  automaticSync: false,
  windowStart: 0,
  windowEnd: 24,
  albumIds: [],
};

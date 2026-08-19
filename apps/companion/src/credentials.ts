import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "fairth.ingestion-token";

export async function getToken(): Promise<string | undefined> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token === null || token.length === 0 ? undefined : token;
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

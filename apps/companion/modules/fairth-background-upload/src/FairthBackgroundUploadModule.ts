import { NativeModule, requireNativeModule } from "expo";
import type { BackgroundUploadStatus } from "./FairthBackgroundUpload.types";

declare class FairthBackgroundUploadModule extends NativeModule<{}> {
  configure(configurationJson: string, token: string): Promise<void>;
  runNow(): Promise<void>;
  enqueueManualAssets(assetsJson: string): Promise<number>;
  enqueueSharedImages(filesJson: string): Promise<number>;
  getStatus(): Promise<BackgroundUploadStatus>;
  checkConnection(): Promise<boolean>;
}

export default requireNativeModule<FairthBackgroundUploadModule>("FairthBackgroundUpload");

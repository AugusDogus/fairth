import { NativeModule, registerWebModule } from "expo";

class FairthBackgroundUploadModule extends NativeModule<{}> {
  private unsupported(): never {
    throw new Error("Background media uploading is available only in the Fairth Android build.");
  }

  async configure(): Promise<void> { this.unsupported(); }
  async runNow(): Promise<void> { this.unsupported(); }
  async enqueueManualAssets(): Promise<number> { return this.unsupported(); }
  async enqueueSharedImages(): Promise<number> { return this.unsupported(); }
  async getStatus(): Promise<never> { return this.unsupported(); }
  async getHistory(): Promise<never> { return this.unsupported(); }
  async retryUpload(): Promise<boolean> { return this.unsupported(); }
  async checkConnection(): Promise<boolean> { return this.unsupported(); }
}

export default registerWebModule(FairthBackgroundUploadModule, "FairthBackgroundUpload");

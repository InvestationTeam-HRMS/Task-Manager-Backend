export enum OtpChannel {
  EMAIL = 'EMAIL',
}

export interface NotificationStrategy {
  sendOtp(recipient: string, otp: string): Promise<boolean>;
  getChannelName(): OtpChannel;
}

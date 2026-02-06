import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseAdminConfig {
  private app?: admin.app.App;

  constructor(private configService: ConfigService) {
    this.initializeApp();
  }

  private initializeApp() {
    // Check if already initialized
    if (admin.apps.length > 0) {
      const existingApp = admin.apps[0];
      if (existingApp) {
        this.app = existingApp;
      }
      return;
    }

    const serviceAccountPath = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_PATH',
    );

    // If service account path is provided, use it
    if (serviceAccountPath) {
      try {
        const serviceAccount = require(serviceAccountPath);
        this.app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log('✅ Firebase Admin initialized with service account');
      } catch (error) {
        console.warn(
          '⚠️ Firebase service account not found, FCM notifications will be disabled',
        );
      }
    } else {
      console.warn(
        '⚠️ FIREBASE_SERVICE_ACCOUNT_PATH not configured, FCM notifications will be disabled',
      );
    }
  }

  getApp(): admin.app.App | undefined {
    return this.app;
  }

  getMessaging(): admin.messaging.Messaging | undefined {
    return this.app ? this.app.messaging() : undefined;
  }
}

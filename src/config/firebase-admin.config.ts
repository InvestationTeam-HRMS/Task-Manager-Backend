import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

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

    // 1. Try to get credentials from JSON string environment variable
    const serviceAccountJson = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );

    if (serviceAccountJson) {
      try {
        const serviceAccount = JSON.parse(serviceAccountJson);
        this.app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log('Firebase Admin initialized with environment variable JSON');
        return;
      } catch (error) {
        console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', error.message);
      }
    }

    // 2. Fallback to file path method
    const serviceAccountPath = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_PATH',
    );

    if (serviceAccountPath) {
      try {
        const resolvedPath = path.isAbsolute(serviceAccountPath)
          ? serviceAccountPath
          : path.resolve(process.cwd(), serviceAccountPath);

        const finalPath = fs.existsSync(resolvedPath)
          ? resolvedPath
          : path.resolve(__dirname, '..', '..', serviceAccountPath);

        if (!fs.existsSync(finalPath)) {
          console.warn(
            'Firebase service account not found, FCM notifications will be disabled',
          );
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const serviceAccount = require(finalPath);
        this.app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log('Firebase Admin initialized with service account file');
      } catch (error) {
        console.warn(
          'Firebase service account file error, FCM notifications will be disabled',
        );
      }
    } else {
      console.warn(
        'Neither FIREBASE_SERVICE_ACCOUNT_JSON nor FIREBASE_SERVICE_ACCOUNT_PATH configured, FCM notifications will be disabled',
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

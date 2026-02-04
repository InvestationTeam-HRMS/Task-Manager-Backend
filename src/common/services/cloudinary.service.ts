import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
  constructor(private configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'hrms/tasks',
    customFileName?: string,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return this.uploadImage(file, folder, customFileName);
  }

  async uploadImage(
    file: Express.Multer.File | string,
    folder: string,
    customFileName?: string,
    uniqueFilename: boolean = true,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      const uploadOptions: any = {
        folder,
        resource_type: 'auto',
      };

      if (customFileName) {
        const nameWithoutExt = customFileName.split('.').slice(0, -1).join('.');
        const sanitizedName = (nameWithoutExt || customFileName).replace(
          /[^a-zA-Z0-9_-]/g,
          '_',
        );
        uploadOptions.public_id = sanitizedName;
        uploadOptions.use_filename = true;
        uploadOptions.unique_filename = uniqueFilename;
      }

      const callback = (error: any, result: any) => {
        if (error) return reject(error);
        if (!result)
          return reject(new Error('Cloudinary upload failed: Empty result'));
        resolve(result);
      };

      if (typeof file === 'string') {
        // Handle base64 string
        cloudinary.uploader.upload(file, uploadOptions, callback);
      } else {
        // Handle Multer file (buffer)
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          callback,
        );
        streamifier.createReadStream(file.buffer).pipe(uploadStream);
      }
    });
  }

  async uploadAvatar(
    file: Express.Multer.File | string,
    userId: string,
  ): Promise<string> {
    const result = await this.uploadImage(
      file,
      'hrms/profiles',
      `avatar_${userId}`,
      false,
    );
    return result.secure_url;
  }

  /**
   * Delete file from Cloudinary (optional but good for cleanup)
   */
  async deleteFile(publicId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(publicId, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
    });
  }
}

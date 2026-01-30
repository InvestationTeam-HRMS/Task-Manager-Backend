import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
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

    async uploadFile(file: Express.Multer.File, customFileName?: string): Promise<UploadApiResponse | UploadApiErrorResponse> {
        return new Promise((resolve, reject) => {
            const uploadOptions: any = {
                folder: 'hrms/tasks',
                resource_type: 'auto',
            };

            if (customFileName) {
                // Sanitize filename for Cloudinary public_id
                // Remove extension as Cloudinary adds it back or handles it via resource_type
                const nameWithoutExt = customFileName.split('.').slice(0, -1).join('.');
                const sanitizedName = (nameWithoutExt || customFileName).replace(/[^a-zA-Z0-9_-]/g, '_');

                uploadOptions.public_id = sanitizedName;
                uploadOptions.use_filename = true;
                uploadOptions.unique_filename = true; // Still keeps a random suffix if name collides, but keeps our prefix
            }

            const uploadStream = cloudinary.uploader.upload_stream(
                uploadOptions,
                (error, result) => {
                    if (error) return reject(error);
                    if (!result) return reject(new Error('Cloudinary upload failed: Empty result'));
                    resolve(result);
                },
            );

            streamifier.createReadStream(file.buffer).pipe(uploadStream);
        });
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

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { toTitleCase } from '../utils/string-helper';

/**
 * Global Interceptor to transform incoming request body
 * - Fields containing "code" (case-insensitive) are converted to UPPERCASE
 * - Other string fields are converted to Title Case (excluding sensitive fields like email/password)
 */
@Injectable()
export class RequestTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const body = request.body;

    if (body && typeof body === 'object') {
      this.transformObject(body);
    }

    return next.handle();
  }

  private transformObject(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    const isExcluded = (key: string) => {
      const lowerKey = key.toLowerCase();
      return (
        [
          'email',
          'password',
          'id',
          'swrkey',
          'status',
          'token',
          'url',
          'path',
          'method',
          'avatar',
          'image',
          'document',
          'b64',
        ].some((ex) => lowerKey.includes(ex)) ||
        key.endsWith('Id') ||
        key.startsWith('_')
      );
    };

    Object.keys(obj).forEach((key) => {
      const value = obj[key];

      if (typeof value === 'string' && value.trim() !== '') {
        // Ignore fields that look like ISO dates or already formatted non-text values
        if (value.match(/^\d{4}-\d{2}-\d{2}/)) return;

        if (key.toLowerCase().includes('code')) {
          obj[key] = value.toUpperCase();
        } else if (!isExcluded(key)) {
          obj[key] = toTitleCase(value);
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.transformObject(value);
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item && typeof item === 'object') {
            this.transformObject(item);
          }
        });
      }
    });
  }
}

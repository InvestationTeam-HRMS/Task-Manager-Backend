# Task Manager Backend - Production-Grade Enterprise Application

## 🚀 Overview

A **complete, production-ready, highly secure, and scalable** Task Manager (Task Management System) backend built with **NestJS**, **PostgreSQL**, **Prisma**, and **Redis**.

## 📋 Features

### ✅ Authentication & Security
- **Password-based authentication** with bcrypt hashing
- **Email OTP verification** for account activation
- **JWT tokens** (Access + Refresh) with rotation
- **Long-lived sessions** with Redis
- **IP address tracking** and verification
- **Cookie-based authentication**
- **Role-Based Access Control (RBAC)**
- **Rate limiting** on all endpoints
- **CSRF protection**
- **Secure headers** with Helmet
- **Strict CORS** configuration

### ✅ Client Group Module (Complete CRUD)
- Create, Read, Update, Delete operations
- Bulk create, update, delete
- Excel/CSV file upload
- Pagination, filtering, sorting, search
- Soft delete with restore capability
- Auto-generated CG numbers (CG-11001, CG-11002, etc.)
- Status management (Active/Inactive)
- Audit trail for all operations

### ✅ Enterprise Features
- **Audit logs** - Track all data changes
- **Activity logs** - Track user activities
- **Redis caching** - Fast data retrieval
- **Session management** - Long-lived persistent sessions
- **File upload** - Cloud-agnostic storage abstraction
- **PDF generation** - Automated API documentation
- **Database transactions** - Data integrity
- **Soft deletes** - Data recovery
- **API versioning** - /api/v1
- **Consistent responses** - Standardized format
- **Error handling** - Centralized error management

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **NestJS** | Backend framework |
| **PostgreSQL** | Primary database |
| **Prisma** | ORM and migrations |
| **Redis** | Cache, sessions, OTP, rate limiting |
| **JWT** | Authentication tokens |
| **bcrypt** | Password hashing |
| **ExcelJS** | Excel file processing |
| **PDFKit** | PDF generation |
| **Helmet** | Security headers |
| **class-validator** | Request validation |

## 📁 Project Structure

```
Task Manager Backend/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── auth/                  # Authentication module
│   │   ├── decorators/        # Custom decorators
│   │   ├── dto/               # Data transfer objects
│   │   ├── guards/            # Auth guards
│   │   ├── strategies/        # Passport strategies
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── auth.module.ts
│   ├── client-group/          # Client Group module
│   │   ├── dto/
│   │   ├── client-group.controller.ts
│   │   ├── client-group.service.ts
│   │   └── client-group.module.ts
│   ├── common/                # Shared utilities
│   │   ├── dto/               # Common DTOs
│   │   ├── filters/           # Exception filters
│   │   └── interceptors/      # Response interceptors
│   ├── pdf/                   # PDF generation module
│   │   ├── pdf.controller.ts
│   │   ├── pdf.service.ts
│   │   └── pdf.module.ts
│   ├── prisma/                # Prisma service
│   │   ├── prisma.service.ts
│   │   └── prisma.module.ts
│   ├── redis/                 # Redis service
│   │   ├── redis.service.ts
│   │   └── redis.module.ts
│   ├── app.module.ts          # Root module
│   └── main.ts                # Application entry point
├── .env                       # Environment variables
├── .env.example               # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.x
- **PostgreSQL** >= 14.x
- **Redis** >= 6.x
- **npm** or **yarn**

### Installation

1. **Clone and navigate to the project**
   ```bash
   cd "Task Manager Backend"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and configure:
   - Database connection string
   - Redis connection details
   - JWT secrets (change in production!)
   - Other configuration values

4. **Setup database**
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

5. **Start the application**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3000`

## 📚 API Documentation

### Generate PDF Documentation

```bash
# Generate API documentation PDF
curl -X POST http://localhost:3000/api/v1/pdf/generate-docs

# Download API documentation
curl -X GET http://localhost:3000/api/v1/pdf/download-docs --output api-docs.pdf
```

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/v1/auth/register` | Register new user | No |
| POST | `/api/v1/auth/verify-otp` | Verify email OTP | No |
| POST | `/api/v1/auth/login` | Login user | No |
| POST | `/api/v1/auth/refresh` | Refresh access token | No |
| POST | `/api/v1/auth/logout` | Logout user | Yes |
| PATCH | `/api/v1/auth/change-password` | Change password | Yes |
| POST | `/api/v1/auth/forgot-password` | Request password reset | No |
| POST | `/api/v1/auth/reset-password` | Reset password with OTP | No |
| GET | `/api/v1/auth/profile` | Get user profile | Yes |

### Client Group Endpoints

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| POST | `/api/v1/client-groups` | Create client group | Yes | ADMIN, SUPER_ADMIN, HR |
| GET | `/api/v1/client-groups` | List all (paginated) | Yes | All |
| GET | `/api/v1/client-groups/active` | List active only | Yes | All |
| GET | `/api/v1/client-groups/:id` | Get by ID | Yes | All |
| GET | `/api/v1/client-groups/by-code/:code` | Get by code | Yes | All |
| PUT | `/api/v1/client-groups/:id` | Update | Yes | ADMIN, SUPER_ADMIN, HR |
| PATCH | `/api/v1/client-groups/:id/status` | Change status | Yes | ADMIN, SUPER_ADMIN, HR |
| DELETE | `/api/v1/client-groups/:id` | Soft delete | Yes | ADMIN, SUPER_ADMIN |
| POST | `/api/v1/client-groups/bulk/create` | Bulk create | Yes | ADMIN, SUPER_ADMIN, HR |
| PUT | `/api/v1/client-groups/bulk/update` | Bulk update | Yes | ADMIN, SUPER_ADMIN, HR |
| DELETE | `/api/v1/client-groups/bulk/delete` | Bulk delete | Yes | ADMIN, SUPER_ADMIN |
| PATCH | `/api/v1/client-groups/:id/restore` | Restore deleted | Yes | ADMIN, SUPER_ADMIN |
| POST | `/api/v1/client-groups/upload/excel` | Upload Excel | Yes | ADMIN, SUPER_ADMIN, HR |

### Demo & Testing

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/v1/demo/run` | Run live demo & generate report | No |

Running the demo will execute a sequence of:
1. User Registration
2. Login (simulated)
3. Create Client Group
4. List Client Groups

And generate a PDF report: `system-demo-report.pdf`.

## 🔐 Security Features

### Password Security
- **bcrypt** hashing with 12 rounds
- Minimum 8 characters required
- Password change tracking

### Token Management
- **Access tokens**: 15 minutes expiry
- **Refresh tokens**: 7 days expiry
- Token rotation on refresh
- Revocation support

### Session Management
- **Long-lived sessions**: 30 days
- Server-side session storage in Redis
- Session invalidation on logout
- IP address tracking

### Rate Limiting
- **General endpoints**: 100 requests/minute
- **Auth endpoints**: 5 requests/15 minutes
- IP-based limiting

### Headers & CORS
- Helmet security headers
- Strict CORS policy
- Cookie security flags

## 📊 Database Schema

### Key Tables

- **users** - User accounts with roles
- **refresh_tokens** - JWT refresh token management
- **sessions** - Active user sessions
- **client_groups** - Client group data
- **audit_logs** - Data change tracking
- **activity_logs** - User activity tracking
- **file_metadata** - File upload metadata

All tables include:
- UUID primary keys
- Timestamps (created_at, updated_at)
- Soft delete support (deleted_at)
- Audit fields (created_by, updated_by, deleted_by)

## 🗄️ Redis Usage

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `otp:{email}` | Email verification OTP | 10 minutes |
| `session:{sessionId}` | User session data | 30 days |
| `refresh:{token}` | Refresh token validation | 7 days |
| `ratelimit:{key}` | Rate limiting counters | 1-15 minutes |
| `cache:{key}` | API response caching | 5 minutes |

## 📤 File Upload

### Excel Upload Format

For Client Group bulk upload, use this Excel format:

| groupNo | groupName | groupCode | country | status | remark |
|---------|-----------|-----------|---------|--------|--------|
| GRP001 | Tech Corp | TECH001 | USA | ACTIVE | Optional |
| GRP002 | Finance Inc | FIN002 | UK | ACTIVE | Optional |

### Cloud Storage

The backend is **cloud-agnostic**. Configure your preferred provider:

- **Local storage** (default)
- **AWS S3**
- **Cloudinary**
- **Google Cloud Storage**
- **Azure Blob Storage**

Update `.env` with provider credentials.

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 🚀 Production Deployment

### Environment Setup

1. Set `NODE_ENV=production`
2. Use strong JWT secrets
3. Enable `COOKIE_SECURE=true` (requires HTTPS)
4. Configure production database
5. Setup Redis cluster
6. Configure cloud storage

### Database Migration

```bash
npx prisma migrate deploy
```

### Build

```bash
npm run build
npm run start:prod
```

## 📝 Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start:prod   # Start production server
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
```

## 🔧 Prisma Commands

```bash
npx prisma generate           # Generate Prisma Client
npx prisma migrate dev        # Create and apply migration
npx prisma migrate deploy     # Apply migrations (production)
npx prisma studio             # Open Prisma Studio (DB GUI)
npx prisma db seed            # Run database seeder
```

## 📈 Performance Optimization

- **Redis caching** for frequently accessed data
- **Database indexing** on all query fields
- **Pagination** for large datasets
- **Lazy loading** of relations
- **Connection pooling** for database
- **Response compression**

## 🛡️ Best Practices Implemented

✅ **Clean Architecture** - Modular, scalable structure  
✅ **SOLID Principles** - Maintainable code  
✅ **DRY** - Reusable components  
✅ **Type Safety** - Full TypeScript coverage  
✅ **Validation** - Request/response validation  
✅ **Error Handling** - Centralized error management  
✅ **Logging** - Comprehensive logging  
✅ **Documentation** - Auto-generated API docs  
✅ **Security** - Production-grade security  
✅ **Testing** - Unit and E2E tests ready  

## 🤝 Contributing

This is a production-ready enterprise backend. Follow these guidelines:

1. Use conventional commits
2. Write tests for new features
3. Update documentation
4. Follow existing code style
5. Create feature branches

## 📄 License

Proprietary - All rights reserved

## 👨‍💻 Author

**Senior Backend Architect**  
Enterprise Task Manager Backend System

---

**Built with ❤️ using NestJS, PostgreSQL, Prisma, and Redis**

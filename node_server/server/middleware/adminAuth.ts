import { Request, Response, NextFunction } from 'express';
import { userRepository } from '../repositories/userRepository';
import { serverCurrentSessionUserId } from '../routes/authRoutes';

export interface AdminAuthRequest extends Request {
  adminUser?: any;
  currentSessionUserId?: string;
}

export async function requireAdmin(req: AdminAuthRequest, res: Response, next: NextFunction) {
  try {
    const rawUserId = 
      (req.headers['x-session-user-id'] as string) || 
      (req.query.userId as string) || 
      (req as any).currentSessionUserId || 
      serverCurrentSessionUserId;

    if (!rawUserId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sesi login tidak valid. Silakan login terlebih dahulu.'
        }
      });
    }

    const user = (await userRepository.findById(rawUserId)) || (await userRepository.findByUsername(rawUserId));
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Akun user tidak ditemukan dalam database.'
        }
      });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_ADMIN_ONLY',
          message: 'Akses ditolak. Rute ini hanya dapat diakses oleh Admin Scrolic.'
        }
      });
    }

    req.adminUser = user;
    req.currentSessionUserId = user.id || user.username;
    next();
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'ADMIN_AUTH_ERROR',
        message: error.message || 'Gagal memvalidasi hak akses admin.'
      }
    });
  }
}

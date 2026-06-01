import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  email: string;
  role: 'CONTROL_CENTRE_TEAM_LEAD' | 'CONTROL_CENTRE_MANAGER' | 'AGENT_RELATIONS_MANAGER'
    | 'LAW_ENGINE_MANAGER' | 'CLIENT_ACCOUNT_MANAGER' | 'TRANSLATION_QA_LEAD'
    | 'AI_QUALITY_OWNER' | 'ADMIN' | 'CLIENT_API';
  clientId?: string; // For client API access
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (...roles: AuthUser['role'][]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}`,
      });
    }
    next();
  };
};

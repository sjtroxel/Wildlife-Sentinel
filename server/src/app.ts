import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { AppError } from './errors.js';
import { healthRouter } from './routes/health.js';
import { adminRouter } from './routes/admin.js';

export const app = express();

app.use(helmet());
app.use(cors({
  origin: config.allowedOrigins,
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false }));

app.use('/health', healthRouter);
app.use('/admin', adminRouter);

// Error handler — must have exactly 4 params for Express to recognize it
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

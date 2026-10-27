import express from 'express';
import { healthResponse } from './health.js';
import { authRouter } from './auth/routes.js';
import { sportsRouter } from './sports/routes.js';
import { membersRouter } from './members/routes.js';
import { organizationsRouter } from './organizations/routes.js';
import { paymentsRouter } from './payments/routes.js';
import { teamsRouter } from './teams/routes.js';
import { eventsRouter } from './events/routes.js';
import { storeRouter,salesRouter } from './store/routes.js';
import {equipmentRouter} from './equipment/routes.js';
import {reportsRouter} from './reports/routes.js';

// Keep app creation separate from app.listen so tests can import it later.
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1/auth', (_req, res, next) => { res.setHeader('Cache-Control','no-store'); next(); }, authRouter());
  app.use('/api/v1/sports', sportsRouter());
  app.use('/api/v1/members', membersRouter());
  app.use('/api/v1/organizations', organizationsRouter());
  app.use('/api/v1/payments', paymentsRouter());
  app.use('/api/v1/teams', teamsRouter());
  app.use('/api/v1/events', eventsRouter());
  app.use('/api/v1/store',storeRouter());
  app.use('/api/v1/sales',salesRouter());
  app.use('/api/v1/equipment',equipmentRouter());
  app.use('/api/v1/reports',reportsRouter());

  app.get('/api/v1/health', (_request, response) => {
    response.status(200).json(healthResponse());
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API route not found. Other endpoints are not implemented yet.',
      },
    });
  });

  app.use((error, _request, response, _next) => {
    // Express rejects malformed JSON here. Do not expose stack traces to browsers.
    if (error?.status === 400 && error?.type === 'entity.parse.failed') {
      return response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' },
      });
    }
    console.error('Unhandled request error:', error?.code || error?.name || 'unknown');
    return response.status(500).json({
      error: { code: 'SERVER_ERROR', message: 'Unexpected server error.' },
    });
  });

  return app;
}

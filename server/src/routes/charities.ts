import { Router } from 'express';
import { getAllCharities, getCharityBySlug, getCharitiesForAlert } from '../db/charityQueries.js';
import { NotFoundError, ValidationError } from '../errors.js';

export const charitiesRouter = Router();

const SLUG_RE = /^[a-z0-9-]+$/;

// GET /charities?species=X,Y&event_type=wildfire&limit=3
// GET /charities  (list all active charities)
charitiesRouter.get('/', async (req, res) => {
  const speciesParam = req.query['species'];
  const eventType = typeof req.query['event_type'] === 'string' ? req.query['event_type'] : '';
  const limitRaw = parseInt(String(req.query['limit'] ?? '3'), 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 3 : limitRaw, 1), 10);

  if (speciesParam !== undefined || eventType) {
    const speciesNames =
      typeof speciesParam === 'string'
        ? speciesParam.split(',').map(s => s.trim()).filter(Boolean)
        : [];
    const charities = await getCharitiesForAlert(speciesNames, eventType, limit);
    res.json(charities);
  } else {
    const charities = await getAllCharities();
    res.json(charities);
  }
});

// GET /charities/:slug
charitiesRouter.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!slug || !SLUG_RE.test(slug)) throw new ValidationError('Invalid charity slug');
  const charity = await getCharityBySlug(slug);
  if (!charity) throw new NotFoundError('Charity not found');
  res.json(charity);
});

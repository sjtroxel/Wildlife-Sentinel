# Testing Rules

## Framework

- **Unit + integration tests:** Vitest
- **E2E tests:** Playwright (added in Phase 9 hardening)
- **Test runner:** `vitest run` (single pass), `vitest` (watch mode)
- Coverage threshold: 80% statement coverage on `server/src/`

## The app.ts / server.ts Split for Tests

Tests import `app` directly from `app.ts`. They never call `listen()`. This is required for supertest to work without port conflicts.

```typescript
import supertest from 'supertest';
import { app } from '../src/app.js';

const request = supertest(app);

describe('GET /health', () => {
  it('returns 200', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
  });
});
```

## LLM Response Fixtures

Never call real AI APIs in tests. All LLM calls must be mocked using fixtures.

Fixture location: `server/tests/fixtures/llm/`

```typescript
// server/tests/fixtures/llm/threat-assessment-wildfire.json
{
  "threat_level": "high",
  "predicted_impact": "Fire likely to spread NW 35km in 24h based on wind data.",
  "confidence_score": 0.78,
  "compounding_factors": ["Species at historic population low", "Dry season conditions"]
}
```

```typescript
// In tests — mock ModelRouter
vi.mock('../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn().mockResolvedValue(
      JSON.parse(readFileSync('tests/fixtures/llm/threat-assessment-wildfire.json', 'utf8'))
    ),
    embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3 /* ... 768 dims */]]),
  }
}));
```

## Redis Mocking

Mock ioredis in tests — do not require a real Redis connection:

```typescript
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      xadd: vi.fn().mockResolvedValue('1234-0'),
      xreadgroup: vi.fn().mockResolvedValue(null),
      xack: vi.fn().mockResolvedValue(1),
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
    })),
  };
});
```

## Database Mocking

Mock postgres.js in tests — do not require a real Neon connection:

```typescript
vi.mock('../src/db/client.js', () => ({
  default: vi.fn(),  // mock the tagged template literal function
}));
```

Integration tests that need a real database should be in a separate `tests/integration/` directory and skipped by default (`test.skip` or a separate Vitest project config).

## Mock Isolation

This pattern from Poster Pilot is required — use in every test file that uses `mockReturnValueOnce`:

```typescript
beforeEach(() => {
  vi.resetAllMocks();
});
```

Without this, queued return values from `mockReturnValueOnce` bleed between tests.

## Testing Scout Agents

Scout agents make HTTP calls to government APIs. Mock these with `vi.stubGlobal` or a fetch mock:

```typescript
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => loadFixture('nasa-firms-response.json'),
}));

afterEach(() => vi.unstubAllGlobals());
```

## What NOT to Do

- Do NOT call real AI APIs in tests — always use fixtures
- Do NOT call real external APIs (NASA, NOAA, etc.) in tests — always use fixtures
- Do NOT require a real Redis or Neon connection in unit tests
- Do NOT add `app.listen()` in test setup — use supertest with `app` directly
- Do NOT skip `vi.resetAllMocks()` in beforeEach when using mockReturnValueOnce

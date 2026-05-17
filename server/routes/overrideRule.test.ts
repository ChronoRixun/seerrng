import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import { getRepository } from '@server/datasource';
import OverrideRule from '@server/entity/OverrideRule';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import overrideRuleRoutes from './overrideRule';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/overrideRule', overrideRuleRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(() => {
  app = createApp();
});

afterEach(() => {
  mock.restoreAll();
});

setupTestDb();

async function login() {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('Override rule route validation', () => {
  it('rejects oversized rule strings before persistence', async () => {
    const agent = await login();
    const beforeCount = await getRepository(OverrideRule).count();

    const res = await agent
      .post('/overrideRule')
      .send({ users: 'x'.repeat(501) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /500 characters or fewer/);
    assert.strictEqual(await getRepository(OverrideRule).count(), beforeCount);
  });

  it('rejects malformed numeric rule fields before persistence', async () => {
    const agent = await login();
    const beforeCount = await getRepository(OverrideRule).count();

    const res = await agent
      .post('/overrideRule')
      .send({ profileId: '1', users: 'admin@seerr.dev' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Profile ID must be a valid ID/);
    assert.strictEqual(await getRepository(OverrideRule).count(), beforeCount);
  });

  it('rejects malformed rule IDs before lookup on update', async () => {
    const agent = await login();

    const res = await agent
      .put('/overrideRule/not-a-number')
      .send({ users: 'admin@seerr.dev' });

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed rule IDs before lookup on delete', async () => {
    const agent = await login();

    const res = await agent.delete('/overrideRule/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('allows explicit nulls to clear optional rule fields', async () => {
    const rule = await getRepository(OverrideRule).save(
      new OverrideRule({
        users: 'admin@seerr.dev',
        genre: 'Action',
        profileId: 1,
      })
    );

    const agent = await login();
    const res = await agent.put(`/overrideRule/${rule.id}`).send({
      users: null,
      genre: null,
      profileId: null,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.users, null);
    assert.strictEqual(res.body.genre, null);
    assert.strictEqual(res.body.profileId, null);
  });
});

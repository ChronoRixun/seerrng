import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { MAX_PERMISSION_VALUE } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import userRoutes from './user';

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
  app.use('/user', userRoutes);
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

before(async () => {
  app = createApp();
});

setupTestDb();

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('User route input validation', () => {
  it('rejects array search parameters on user list requests', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user').query({ q: ['admin', 'friend'] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Search query must be a string/);
  });

  it('rejects malformed includeIds on user list requests', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user').query({ includeIds: '1,nope' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /includeIds contains an invalid id/i);
  });

  it('returns 404 for malformed profile IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('returns 404 for malformed quota IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/not-a-number/quota');

    assert.strictEqual(res.status, 404);
  });

  it('returns 404 for malformed watchlist profile IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/not-a-number/watchlist');

    assert.strictEqual(res.status, 404);
  });

  it('returns 404 for malformed settings profile IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/not-a-number/settings/main');

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed password update bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/password').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects invalid password update bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/password').send({});

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /newPassword/i);
  });

  it('rejects malformed main settings bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/main').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects malformed notification settings bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/notifications').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects malformed push subscription bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/registerPushSubscription').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('rejects malformed push subscription endpoint params before lookup', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const getRes = await agent.get('/user/1/pushSubscription/not-a-url');
    const deleteRes = await agent.delete('/user/1/pushSubscription/not-a-url');

    assert.strictEqual(getRes.status, 400);
    assert.match(getRes.body.message, /endpoint must be a valid URL/i);
    assert.strictEqual(deleteRes.status, 400);
    assert.match(deleteRes.body.message, /endpoint must be a valid URL/i);
  });

  it('rejects unsafe push subscription endpoints before persistence or lookup', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const credentialedRes = await agent
      .post('/user/registerPushSubscription')
      .send({
        endpoint: 'https://user:pass@push.example.com/sub',
        auth: 'auth',
        p256dh: 'p256dh',
      });
    const privateRes = await agent.post('/user/registerPushSubscription').send({
      endpoint: 'https://127.0.0.1/push',
      auth: 'auth',
      p256dh: 'p256dh',
    });
    const privateLookupRes = await agent.get(
      '/user/1/pushSubscription/https%3A%2F%2F127.0.0.1%2Fpush'
    );

    assert.strictEqual(credentialedRes.status, 400);
    assert.match(
      credentialedRes.body.message,
      /endpoint must not include credentials/i
    );
    assert.strictEqual(privateRes.status, 400);
    assert.match(
      privateRes.body.message,
      /endpoint must be a public HTTPS URL/i
    );
    assert.strictEqual(privateLookupRes.status, 400);
    assert.match(
      privateLookupRes.body.message,
      /endpoint must be a public HTTPS URL/i
    );
  });

  it('rejects malformed local user create bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('rejects malformed user update bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put('/user/2').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('rejects malformed Plex linked account bodies before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .post('/user/1/settings/linked-accounts/plex')
      .send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects malformed Jellyfin linked account bodies before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .post('/user/1/settings/linked-accounts/jellyfin')
      .send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects invalid settings permission payloads', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/2/settings/permissions').send({
      permissions: 'not-a-number',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /permissions is invalid/i);
  });

  it('rejects malformed settings permission bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/2/settings/permissions').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects unknown permission bits on settings permission updates', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/2/settings/permissions').send({
      permissions: MAX_PERMISSION_VALUE + 1,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /permissions is invalid/i);
  });

  it('rejects unknown permission bits on bulk permission updates', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put('/user').send({
      ids: [2],
      permissions: MAX_PERMISSION_VALUE + 1,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /permissions is invalid/i);
  });

  it('rejects malformed bulk permission bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put('/user').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('rejects malformed Plex import bodies before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/import-from-plex').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('rejects malformed Jellyfin import bodies before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/import-from-jellyfin').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('saves card text visibility settings per user', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const saveRes = await agent.post('/user/1/settings/card-text').send({
      movie: 'always',
      book: 'hover',
    });

    assert.strictEqual(saveRes.status, 200);
    assert.deepStrictEqual(saveRes.body, {
      movie: 'always',
      book: 'hover',
    });

    const getRes = await agent.get('/user/1/settings/card-text');
    assert.strictEqual(getRes.status, 200);
    assert.deepStrictEqual(getRes.body, {
      movie: 'always',
      book: 'hover',
    });

    const user = await getRepository(User).findOneOrFail({
      where: { id: 1 },
    });
    assert.strictEqual(user.settings?.cardTextVisibilityMovie, 'always');
    assert.strictEqual(user.settings?.cardTextVisibilityBook, 'hover');
  });

  it('saves card text visibility through main user settings without clearing other media types', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    await agent.post('/user/1/settings/card-text').send({
      movie: 'always',
      book: 'hover',
    });

    const saveRes = await agent.post('/user/1/settings/main').send({
      username: 'admin',
      email: 'admin@seerr.dev',
      cardTextVisibility: {
        tv: 'always',
        album: 'hover',
      },
    });

    assert.strictEqual(saveRes.status, 200);
    assert.deepStrictEqual(saveRes.body.cardTextVisibility, {
      movie: 'always',
      tv: 'always',
      album: 'hover',
      book: 'hover',
    });

    const user = await getRepository(User).findOneOrFail({
      where: { id: 1 },
    });
    assert.strictEqual(user.settings?.cardTextVisibilityMovie, 'always');
    assert.strictEqual(user.settings?.cardTextVisibilityTv, 'always');
    assert.strictEqual(user.settings?.cardTextVisibilityAlbum, 'hover');
    assert.strictEqual(user.settings?.cardTextVisibilityBook, 'hover');
  });

  it('rejects invalid card text visibility values', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/card-text').send({
      album: 'sometimes',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /album must be "always" or "hover"/i);
  });

  it('rejects malformed card text visibility bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/card-text').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });
});

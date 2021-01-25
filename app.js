import axios from 'axios';
import express from 'express';
import { go, map, omit, pick, strMap } from 'fxjs';
const app = express();
const port = 80;

import { config } from 'dotenv';
config();
import { PostgreSQL } from 'fxsql';
const { CONNECT } = PostgreSQL;

const POOL = CONNECT({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  database: process.env.DATABASE_NAME,
});

const STRAVA_API = 'https://www.strava.com/api/v3/';

app.get('/', async (req, res, next) => {
  const { QUERY1 } = POOL;

  try {
    const {
      strava: { access_token, refresh_token, expires_at },
    } = await QUERY1`SELECT strava FROM users WHERE id = 1`;

    const currentTime = Math.floor(new Date().getTime() / 1000);

    if (currentTime > expires_at) {
      await go(
        axios.post(`${STRAVA_API}/oauth/token`, null, {
          params: {
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token,
          },
        }),
        ({ data }) =>
          QUERY1`UPDATE users SET strava = ${data} WHERE id = 1 RETURNING strava`,
      );
    }

    await go(
      axios.get(`${STRAVA_API}/activities`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
        params: {
          include_all_efforts: true,
        },
      }),
      ({ data }) =>
        res.send(
          access_token
            ? `
                <div>
                    <p>connected strava</p>
                    <ul>
                        ${strMap(
                          ({ name, average_watts, weighted_average_watts }) =>
                            `<li>${name}</br>평균파워: ${average_watts}, NP: ${weighted_average_watts}</li>`,
                          data,
                        )}
                    </ul>
                </div>
              `
            : `
              <a href="https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&response_type=code&redirect_uri=http://localhost/api/oauth&approval_prompt=force&scope=read,read_all,profile:read_all,profile:write,activity:read,activity:read_all,activity:write">
                Connect Starava
              </a>
            `,
        ),
    );
  } catch (err) {
    console.log(err.response?.data);
    next(err);
  }
});

app.get('/api/oauth', async (req, res, next) => {
  const { state, code, scope } = req.query;

  const { TRANSACTION } = POOL;

  const { QUERY1, QUERY, COMMIT, ROLLBACK } = await TRANSACTION();

  try {
    await go(
      axios.post(
        `https://www.strava.com/oauth/token?client_id=${process.env.STRAVA_CLIENT_ID}&client_secret=${process.env.STRAVA_CLIENT_SECRET}&code=${code}`,
      ),
      async ({ data }) => {
        // TODO: 그대로 JSONB 저장하기, 토큰은 cookie || localStrage, expire 시점은 고민 해 보기
        const authenticate_info = pick(
          ['expires_at', 'expires_in', 'refresh_token', 'access_token'],
          data,
        );
        const dataa = await QUERY1`UPDATE users SET strava = ${authenticate_info} WHERE id = 1 RETURNING strava`;
        await COMMIT();
        console.log(dataa);
        // console.log(pick(['access_token', 'refresh_token'], data));
      },
    );
  } catch (err) {
    console.log(err);
    await ROLLBACK();
    next(err);
  }

  res.send('success');
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});

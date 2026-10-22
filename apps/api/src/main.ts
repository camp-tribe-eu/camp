import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { corsOptions } from './cors';

// CAMP-32 made this necessary: until now every call to the API came from
// the Next build on the server, and the browser never spoke to it. The
// map asks for the campsites under the viewport at run time, from the
// reader's browser, and the site and the API are on different hosts.
//
// 🔴 An allowlist, never `origin: true`. Reflecting whatever Origin
// arrives is the same as having no CORS at all: any page on any domain
// could read our data through a visitor's browser. The list is empty by
// default, so a machine that was never configured stays closed rather
// than opening itself — and the only cost of getting that wrong is a
// clear CORS error in the console, which is a far better failure than a
// quiet leak.
function corsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const origins = corsOrigins();
  if (origins.length > 0) {
    // The options live in cors.ts, where a test can reach them. Read there
    // before changing anything here: `Authorization` is allowed on purpose.
    app.enableCors(corsOptions(origins));
  }

  // CAMP-142: say out loud whether the build may bypass the rate limit.
  //
  // 🔴 One line, because the absence of this line cost seven hours. The
  // token was added to `.env` ten minutes AFTER this process last
  // started; ConfigModule reads `.env` only at boot, so the running API
  // had never heard of it and `isExempt()` failed closed exactly as it
  // promises. Nothing anywhere said so — the build merely got slow, and
  // slow was misread as a bug in the bypass rather than a stale process.
  //
  // The value is never printed, only whether one is configured. The
  // build's own check (apps/web/scripts/check-build-bypass.mjs) proves
  // the token actually WORKS; this is the line that makes the cause
  // obvious once it does not.
  console.log(
    process.env.API_BUILD_TOKEN
      ? '[throttle] build-token exemption: configured'
      : '[throttle] build-token exemption: NOT configured — builds will be rate-limited',
  );

  // CAMP-385: адреса, а не лише порт.
  //
  // 🔴 ЗАМІРЯНО НА ПРОДІ 22.10.2026: `ss -ltn` показував `*:3001` — усі
  // інтерфейси. Nest без другого аргументу слухає 0.0.0.0, і від інтернету
  // API тримало ОДНЕ правило фаєрвола: у ufw немає дозволу на 3001, тож
  // спрацьовувала заборона за замовчуванням. Юніт systemd при цьому
  // стверджував «слухає лише локально». `ufw allow 3001` для налагодження
  // виставив би назовні, повз Caddy і гейт, маршрути /auth/signup,
  // /auth/forgot і /auth/resend-verification, які шлють справжню пошту
  // нашим SMTP на будь-яку адресу.
  //
  // Назовні API пускає Caddy (`reverse_proxy 127.0.0.1:3001`), і CI, і
  // тимчасова збіркова API деплою (`infra/bin/camptribe-deploy`,
  // start_temp_api) стукають у 127.0.0.1 / localhost на тій самій машині
  // — їм інший порт потрібен, інша адреса ні. Змінна лишається для того,
  // хто справді мусить слухати ширше (контейнер, стенд у LAN), і носить
  // те саме імʼя, що в юніті Directus: `HOST`.
  //
  // 🔴 `||`, А НЕ `??` — ЗАМІРЯНО. `listen(port, '')` на Node 22.23.2 і
  // 24.18.0 біндить `:::`, тобто всі інтерфейси; а `HOST=` порожнім рядком
  // у `.env` (EnvironmentFile і ConfigModule читають його саме так) при
  // `??` пройшов би як адреса. Порожнє мусить означати «не задано».
  //
  // Сторож: scripts/ci/check-api-binds-loopback.mjs — читає цей виклик
  // через AST і червоніє без адреси, на wildcard і на `??`.
  await app.listen(process.env.PORT ?? 3000, process.env.HOST || '127.0.0.1');
}
bootstrap();

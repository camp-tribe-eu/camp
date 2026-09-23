import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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
    app.enableCors({
      origin: origins,
      // 🔴 POST is here for exactly one route: CAMP-92's client-error
      // report, which a broken page sends from the reader's browser.
      // It is safe to add only because the allowlist above is still the
      // gate — a POST from an origin we did not list never reaches the
      // handler — and because the endpoint itself validates, truncates
      // and rate-limits everything it accepts. If a future route needs
      // a wider method set, it needs its own reasoning, not this one.
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type'],
      // We send no cookies and no Authorization, so credentials must stay
      // off — turning them on is what makes a mistaken allowlist entry
      // dangerous rather than merely wrong.
      credentials: false,
      maxAge: 86_400,
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

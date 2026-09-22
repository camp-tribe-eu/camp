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
      methods: ['GET'],
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

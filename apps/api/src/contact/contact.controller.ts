import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MAIL_LIMIT } from '../throttle';
import { parseContact, type ContactProblem } from './contact.rules';
import { ContactService } from './contact.service';

// 🔴 The MAIL bucket: what this route costs is a LETTER from our domain, and
// `MAIL_LIMIT` is the number the project already chose for that. `MAIL_ROUTES`
// in throttle.ts sets the counter, and throttle.spec.ts reads this file to
// check the two agree (the CAMP-176 comparison).
const MAIL = { default: MAIL_LIMIT };

function invalid(problems: ContactProblem[]): HttpException {
  return new HttpException(
    {
      code: 'invalid_message',
      message:
        problems.length === 1
          ? problems[0].message
          : `${problems.length} things are wrong with this message; see \`errors\`.`,
      errors: problems,
    },
    400,
  );
}

/**
 * «Write to us» — the endpoint the contact page's form talks to.
 *
 * 🔴 OPEN TO ANYONE, and it has to be: the person writing is not an account
 * holder. It stores NOTHING — the body becomes one letter to the project
 * mailbox and is dropped; there is no table and no GET.
 *
 *   POST /contact
 *   { "name": "Anna", "email": "anna@example.eu", "subject": "optional",
 *     "message": "…", "leaveBlank": "", "elapsedMs": 8123 }
 *
 *   200 { ok: true }                 sent — or a script was told so (see service)
 *   400 { code: 'invalid_message', errors: [{ field, code, message }] }
 *   429                              the `mail` bucket is spent
 *   503 { code: 'mail_unavailable' } no mail sender, or the send failed
 */
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @HttpCode(200)
  @Throttle(MAIL)
  async send(@Body() body: unknown): Promise<{ ok: true }> {
    const parsed = parseContact(body);
    // `=== false`, not `!ok`: this package builds without strictNullChecks.
    if (parsed.ok === false) throw invalid(parsed.problems);
    const outcome = await this.contact.accept(parsed.contact);
    if (outcome === 'unavailable') {
      throw new HttpException(
        {
          code: 'mail_unavailable',
          message: 'We could not send your message just now.',
        },
        503,
      );
    }
    return { ok: true };
  }
}

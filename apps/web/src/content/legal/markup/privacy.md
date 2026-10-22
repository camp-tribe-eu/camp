## Who is responsible {#who}

{{company.address}} is the controller for personal data processed through this site. You can reach a person at [{{company.email}}](mailto:{{company.email}}).

> **The short version.** You can use almost all of this site without an account, and we would rather you did. If you make one, we hold your email address, a one-way hash of your password, and whatever you save — trips, places, photos. No advertising, no tracking pixels, no third-party analytics, and nothing sold or shared. You can download everything we hold, or delete the account, from your account pages, without asking us.

## What we process, and why {#what}

### Serving the pages

A page request passes through two hands. Cloudflare receives it first, as our content delivery network and reverse proxy, and it necessarily sees your IP address, the page asked for and your browser’s user-agent string. It then forwards the request to our own server, which is where the site is actually hosted and which sees the same information in order to answer.

- **Who does it:** Cloudflare, Inc. as CDN and proxy, and Hetzner Online GmbH (Germany) as the provider of the machine that serves the site. Both act as our processors under Article 28 GDPR.
- **Legal basis:** our legitimate interests in operating the service and defending it from abuse — Article 6(1)(f) GDPR.
- **Kept for:** fourteen days on our own server, in the security log described next. Cloudflare keeps its own operational logs inside its platform under its retention policy; we do not export them, build profiles from them, or use them for anything but keeping the site up.

### The security log

Our web server writes one line for every request it answers. We turned this on deliberately, and it is the one place on our machine where your IP address is written down. Sites get attacked; a log is the difference between knowing what happened and guessing.

Each line holds:

- the time, to the second;
- your IP address as our content delivery network passes it to us, and the two-letter country code it derives from that address;
- the address of the page you asked for, the method, and the status we answered with;
- your browser’s user-agent string, the TLS version and cipher it negotiated, how many bytes we sent, and how long we took.

The rest of each line is about the connection rather than about you: which name the request arrived under, what your browser said it could accept, and the identifiers our content delivery network uses to trace a request through its own machines.

It does **not** hold the contents of your cookies or of any authorisation header. The server writes the word REDACTED in their place before the line reaches the file, so a copy of this log is not a way to sign in as you.

One thing it does hold is worth saying plainly, because it is easy to miss. Several tools on this site keep their state in the page address, so that a link can be reloaded or sent to someone: what you type into the site search, the filters you set on the map, and the answers you give the packing list and the trip cost calculator. While you are using them nothing is sent to us — they run in your browser. That address reaches us, and this log, when the page is **loaded** with it: because you reloaded, or because you or somebody else opened a saved link. Then whatever is in the address is written down with the rest of the line, and it goes when that line goes.

- **Who does it:** us, on our own server. The file can be read only by the account the web server runs as and by whoever administers the machine — not by the application that serves you — and it is appended to, never rewritten. Nothing copies it to anyone else.
- **Legal basis:** our legitimate interest in keeping this service secure — Article 6(1)(f) GDPR. Recital 49 names network and information security as exactly that kind of interest, and Article 32 requires us to take measures of this sort. We do not ask for your consent here, and saying so plainly is part of being honest about it: a security log that stops recording for whoever declines would not be a security log.
- **Kept for:** fourteen days. The server deletes older lines by itself, on a schedule, rather than waiting for someone to remember.
- **Not used for:** analytics, audience measurement, advertising, profiling, or any decision about you. It is read when something looks wrong, and otherwise it is not read at all.

You can object to this under Article 21 GDPR by writing to us. We will weigh your objection against the security interest and tell you what we decided and why.

### Your account, if you make one

An account exists so that what you save stays yours across devices. We hold the following, and nothing else:

- your email address, and whether you have confirmed it;
- a **hash** of your password — a one-way transformation, not the password. We cannot read it, recover it or tell you what it was;
- whether and when you agreed to receive our emails, recorded separately so that consent can be proven and withdrawn;
- sessions — the fact that a browser is signed in, and until when;
- what you saved: trips and their stops, saved places, photos you submitted, reviews you wrote.

- **Legal basis:** performance of the contract you entered into by creating the account — Article 6(1)(b) GDPR. For the newsletter flag specifically, your consent — Article 6(1)(a).

### Email we send you

Confirming your address and resetting your password require us to send you an email, so your address passes to the mail system that carries it.

- **Who does it:** Hetzner Online GmbH (Germany), which operates our mailboxes and carries outgoing mail.
- **Legal basis:** performance of the contract — Article 6(1)(b) GDPR — for account mail; consent for anything we send you because you asked to hear from us.

### Your cookie choice

If you answer the cookie banner, we store that answer — and only that answer — on your own device, so we do not have to ask again. It never reaches our servers and it identifies nothing. The details are on the [cookies](/legal/cookies) page.

### Writing to us

If you send us an email, we have your email address and whatever you put in the message, for as long as it takes to deal with it and for a reasonable period afterwards.

- **Legal basis:** our legitimate interest in answering people who write to us — Article 6(1)(f) GDPR.

### What we do not do

- No advertising and no advertising networks.
- No automated decision-making that produces legal or similarly significant effects, and no profiling of you as a person — Article 22 GDPR does not arise. What you save is shown back to you; it is not used to score or categorise you.
- No selling, renting or sharing of personal data.
- No social-media buttons that report your visit back to a social network.

## Who else sees it {#who-else}

Three processors, each acting only on our instructions under a contract that says so — Article 28 GDPR:

- **Hetzner Online GmbH**, Germany — the server that hosts the site and the database, and the mail system. Inside the EU, so no transfer question arises.
- **Cloudflare, Inc.** — content delivery network and reverse proxy in front of that server. Where this involves a transfer outside the European Economic Area, it is covered by the European Commission’s Standard Contractual Clauses.

That is the complete list. Nobody else receives personal data from this site, except where we are legally required to disclose it — and if that list ever grows, this page grows with it in the same release.

## The map {#map}

The map draws its background tiles from an external provider, which means your browser connects to that provider directly and it can see your IP address and which tiles you asked for, in the same way any image on the web works. We do not send it anything about you, and it sets no cookies through us. Which provider is in use is shown under the map, and you can switch it.

## How long we keep it {#keep}

- **Account data:** until you delete the account. We do not expire accounts for inactivity.
- **Sessions:** thirty days, then they expire on their own. Signing out ends one immediately; changing your password ends all of them.
- **Links we email you** — confirmation and password reset: one hour, and single-use.

## Your rights {#rights}

Under the GDPR you may ask us to give you a copy of your personal data, correct it, delete it, restrict or object to our use of it, or hand it to someone else in a portable form. Where we rely on your consent you can withdraw it at any time, and withdrawing is as easy as giving it.

For two of those you do not have to ask us at all. If you have an account, you can **download a file containing everything we hold about you** and you can **delete the account**, both from your account pages. Deleting ends your access in the same request — not in thirty days.

> **What deletion does not reach, and why.** One record survives: that a photo or a review was rejected, why, when, and for which place. It carries nothing that points back to you — no name, no address, not even a reference to the account that was deleted. Because no part of it identifies a person, it has stopped being personal data, and the right to erasure has nothing left to reach. We keep it to be able to account for our own moderation decisions. Separately, the licence you granted for photographs already published is a contract rather than personal data, so those photographs may remain — but your name comes off them on request. We would rather tell you where the line is than let you discover it.

For anything else, write to [{{company.email}}](mailto:{{company.email}}). We answer within one month, and if a request is complex enough to need longer we will tell you inside that month and say why — which is what Article 12(3) allows and requires.

> **If we get it wrong.** You can complain to a data protection authority. Ours is the Belgian [Gegevensbeschermingsautoriteit / Autorité de protection des données](https://www.gegevensbeschermingsautoriteit.be/), and you may also complain to the authority where you live or work.

## Children {#children}

Reading this site needs no account and no age. Opening one requires you to be eighteen, and we ask you to confirm that rather than asking for your date of birth — a date we would then be holding and would have to protect, to answer a question that a yes already answers.

This site is not aimed at children, and we do not knowingly open accounts for them or collect anything from them. If you believe a child has given us personal data, write to us and we will remove it.

## Changes {#changes}

The version of this policy and the date it took effect are at the top of the page. Earlier versions are in our public source repository, so what applied on any given day can be established exactly.
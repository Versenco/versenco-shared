# @versenco/sso — Design

**Date** : 2026-09-25
**Statut** : Brouillon pour relecture (sections 1 à 3 validées en brainstorming)
**Contexte** : Deuxième brique de `versenco-shared`, après `@versenco/vcoin-client`.
Aujourd'hui, chaque app satellite réimplémente le flux OAuth2 + PKCE à la main
(sovereign-connect : `src/lib/sso.ts` + edge function `sso-exchange` ; codeben :
`lib/sso.ts` + `sso-exchange`). Cette duplication est du code de sécurité copié
sans discipline, et elle est la principale barrière à l'intégration par des
développeurs externes.

## 1. Objectif et périmètre

Un package TypeScript **public sur npm** (`@versenco/sso`) qui permet à une app
d'ajouter « Se connecter avec Versenco » en quelques lignes, sans écrire de code
OAuth/OIDC. Comme `vcoin-client`, il est conçu pour des consommateurs externes :
rien n'y suppose un consommateur de confiance interne.

Publier le SDK **n'ouvre pas l'accès** : un client OAuth reste enregistré par un
admin versen-connect (`/admin/sso-clients`), qui fournit `client_id` et
`client_secret`. Aucun changement côté versen-connect n'est requis pour publier.

**Périmètre v1**
- Flux Authorization Code + PKCE (S256), client **confidentiel** (secret côté serveur).
- Un cœur sans framework et un adaptateur **Next.js 16** (App Router).
- Session applicative par cookie signé, sans état côté SDK.

**Hors périmètre v1** (extensibles sans casser l'API)
- Déconnexion back-channel (le `sid` est conservé pour la préparer).
- Refresh token (le SSO n'en émet pas, voir §3).
- Clients publics (SPA sans serveur), autres frameworks (Express, SvelteKit).
- Migration des apps existantes : travail séparé. VersenAds est le premier consommateur.

## 2. Forme du paquet

Un seul paquet, deux points d'entrée :

| Import | Contenu | Dépendances |
|---|---|---|
| `@versenco/sso` | Cœur : URL d'autorisation, validation du retour, échange du code, vérification de l'`id_token` | `oauth4webapi` |
| `@versenco/sso/next` | Routes `login`/`callback`/`logout`, cookie de session, `getSession()`/`requireSession()`, helper `proxy.ts` | `jose`, `next` (peer, optionnel) |

Un seul paquet plutôt que deux : chaque paquet npm impose un premier publish
manuel puis une approbation 2FA par version (voir §7). Un second adaptateur
s'ajoutera plus tard en sous-chemin, sans rupture. Le cœur reste importable
sans `next` installé.

Dépendances retenues : `oauth4webapi` 3.x (zéro dépendance, validé par prototype,
voir §8) et `jose` 6.x (zéro dépendance). Aucune cryptographie écrite à la main.

## 3. Configuration et découverte

```ts
// Cœur : aucune session, donc pas de sessionSecret
const sso = createSso({
  issuer: "https://auth.versenco.com",
  clientId: process.env.VERSEN_CLIENT_ID!,
  clientSecret: process.env.VERSEN_CLIENT_SECRET!,
  redirectUri: "https://app.example.com/auth/callback",
});

// Adaptateur Next.js : mêmes options + la session
const app = createNextSso({ /* mêmes options */, sessionSecret: process.env.SESSION_SECRET! /* >= 32 octets */ });
```

Le SDK **découvre** les endpoints via `/.well-known/openid-configuration` (mis en
cache mémoire) : plus aucune URL Supabase en dur, et une migration vers du
self-host reste transparente pour les apps.

**Validation au démarrage** : `createSso` échoue immédiatement si `issuer` ou
`redirectUri` ne sont pas en `https` (sauf loopback) ou sont invalides, ou si
`clientId`/`clientSecret` sont vides ; `createNextSso` échoue en plus si
`sessionSecret` fait moins de 32 octets. Une erreur de configuration se voit au boot, pas
au premier login.

**Authentification du client** : `client_secret_post`. Le prototype a confirmé que
le SSO l'accepte (`client_secret_basic` aussi).

## 4. Cœur (`@versenco/sso`)

- `sso.authorizationUrl()` → `{ url, state, nonce, codeVerifier }` (le `returnTo` est géré par l'adaptateur).
  Génère `state`, `nonce` et le couple PKCE avec les primitives d'`oauth4webapi`.
  Scopes par défaut : `openid profile email`.
- `sso.handleCallback(callbackUrl, { state, nonce, codeVerifier })` → claims validés :
  1. `validateAuthResponse` (présence de `code`, erreur du fournisseur, `state`) ;
  2. échange du code (`authorizationCodeGrantRequest`) ;
  3. `processAuthorizationCodeResponse` avec `expectedNonce` et `requireIdToken: true`
     (contrôle `iss`, `aud`, `exp`, `nonce`) ;
  4. **vérification de signature** de l'`id_token` via le JWKS. Elle est facultative
     par défaut dans `oauth4webapi` (il se fie à TLS) ; le SDK l'active toujours,
     en défense en profondeur.
- `sso.userInfo(accessToken)` → profil complet (`sub, email, email_verified, name`).
- `sso.endSessionUrl({ idTokenHint, postLogoutRedirectUri })` → URL d'`end_session_endpoint`.

**Piège documenté** : `validateApplicationLevelSignature` exige la *même* instance
de `Response` que celle traitée par `processAuthorizationCodeResponse`, pas un clone.

Claims exposés : `sub`, `email`, `email_verified`, `name`, `sid`, `iat`, `exp`.

## 5. Adaptateur Next.js et session (`@versenco/sso/next`)

**Routes** : `handlers.login`, `handlers.callback`, `handlers.logout`, à monter dans
des route handlers de l'App Router.

**Déroulé du callback**
1. Lire et supprimer le cookie `versen_oauth` ; appeler `handleCallback`.
2. Appeler le hook optionnel `onLogin(claims)`, où l'app crée ou met à jour son
   utilisateur. S'il lève une erreur, **aucune session n'est créée**.
3. Poser le cookie de session `versen_session` (JWT signé HS256 via `jose`) contenant
   `sub`, `email`, `name`, `sid`, `iat`, `exp` **et l'`id_token`** : `sso-end-session`
   ne sait pas quel utilisateur déconnecter sans `id_token_hint` (ou jeton Bearer).
   Si le cookie dépasse ~3,8 Ko, l'`id_token` est omis plutôt que le cookie perdu.
   Puis rediriger vers `returnTo`.

**Cookie de session** : `HttpOnly`, `Secure` (sauf localhost), `SameSite=Lax`, `Path=/`.
Durée **absolue** de 8 h, configurable, **sans prolongation glissante** : le SSO ne
fournit pas de refresh token (constaté au prototype), donc à l'expiration on repasse
par `/authorize`, quasi instantané si l'utilisateur est encore connecté au SSO.

**État du login en cours** : cookie temporaire signé `versen_oauth`, 10 minutes,
contenant `state`, `nonce`, `codeVerifier`, `returnTo`. Supprimé au callback.
`returnTo` n'accepte que des **chemins relatifs de même origine** (contre les
redirections ouvertes).

**API applicative** (Next.js 16, `cookies()` est asynchrone) :
- `getSession()` → session ou `null`, utilisable dans Server Components et route handlers ;
- `requireSession()` → session, ou redirection vers `login` ;
- `getSessionFromRequest(request)` : pour `proxy.ts`, où `cookies()` de `next/headers`
  n'est pas disponible.

**Logout** : efface `versen_session`, puis redirige vers l'`end_session_endpoint`
(avec `id_token_hint` et `client_id`). GET et POST acceptés.

## 6. Erreurs et tests

**Erreurs typées** : `SsoError` avec `code` stable (`invalid_state`,
`authorization_failed`, `token_exchange_failed`, `invalid_id_token`,
`discovery_failed`, `userinfo_failed`, `login_rejected`, `config_invalid`).
Les messages ne contiennent **jamais** de secret ni de jeton. L'adaptateur redirige
vers une page d'erreur configurable (`errorPath`, avec `?code=`) au lieu d'une 500 brute.

**Tests unitaires** (Vitest, comme `vcoin-client`) contre un **faux fournisseur OIDC
local** (`node:http` + une paire de clés `jose`), pour lancer les attaques que le
prototype ne lançait pas :

| Cas | Attendu |
|---|---|
| `state` absent ou altéré | `invalid_state` |
| `nonce` différent | `invalid_id_token` |
| Code rejoué | `token_exchange_failed` |
| `id_token` expiré | `invalid_id_token` |
| Mauvais `aud` / `iss` | `invalid_id_token` |
| Signature avec une autre clé | `invalid_id_token` |
| `alg: none` ou HS256 forgé | rejeté |
| Cookie de session altéré ou expiré | `getSession()` → `null` |
| `returnTo` absolu ou `//evil.com` | remplacé par `/` |
| `sessionSecret` trop court | `config_invalid` au démarrage |

**Test d'intégration optionnel**, hors CI : rejoue le prototype contre le vrai
`auth.versenco.com` avec un client dédié (secret dans un `.env` local, jamais commité).

## 7. Distribution

Identique à `vcoin-client` : package public `@versenco/sso`, build `tsup`
(ESM + CJS + `.d.ts`), tag `sso@<version>` déclenchant un workflow qui teste,
vérifie les types, construit puis **met en attente** la version (`npm stage publish
--provenance`). Elle ne devient publique qu'après approbation 2FA du mainteneur
(`npm stage approve`). Le **premier publish** du nouveau paquet est manuel.
Versions `0.x` tant que l'API n'a pas été éprouvée par VersenAds, puis `1.0`.

## 8. Ce que le prototype a établi

Un prototype jetable (non conservé) a réalisé un login réel contre `auth.versenco.com`
avec `oauth4webapi` : découverte, PKCE S256, `client_secret_post`, `state`, échange
du code, claims de l'`id_token`, signature RS256 via JWKS, `userinfo` : **tout a passé**.

Constats à retenir :
- **Pas de `refresh_token`** dans la réponse : `access_token, token_type, expires_in,
  id_token, scope` seulement.
- Claims de l'`id_token` : `sub, email, email_verified, name, jti, iat, exp, iss, aud,
  nonce, sid`.
- Le SSO annonce `code_challenge_methods_supported: [S256]` et
  `id_token_signing_alg_values_supported: [RS256]`.
- `iss` ne figure pas dans la réponse d'autorisation
  (`authorization_response_iss_parameter_supported` absent) : pas de défense
  RFC 9207 possible pour l'instant.

## 9. Prérequis de sécurité côté fournisseur d'identité

Le SDK ne peut pas compenser les failles du fournisseur. Avant de le promouvoir à
des tiers, confirmer les points de `SSO/SECURITY-AUDIT-2026-09-23.md` :
- **C1** (`sso_auth_codes` sans RLS) : refus confirmé pour `anon` (`permission denied`),
  **à confirmer pour `authenticated`** ;
- **C6** (`redirect_uri` par préfixe) : corrigé dans le code du dépôt, **à confirmer
  sur la version déployée** ;
- retrait du repli **HS256** de `sso-token` en production (il est réservé au dev local
  et se déclenche si `JWT_PRIVATE_KEY_JWK` est absent : à vérifier que le secret est
  bien défini en prod).

## 10. Questions ouvertes

- ~~Nom des cookies~~ : résolu, option `cookiePrefix` (défaut `versen`).
- Faut-il exposer `userInfo` dans la session par défaut, ou uniquement à la demande ?
- Politique de compatibilité : versions minimales de Next.js supportées (16 seulement,
  ou 15 aussi) ?

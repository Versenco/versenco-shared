# @versenco/vcoin-client — Design

**Date** : 2026-09-22
**Statut** : Approuvé pour passage au plan d'implémentation
**Contexte** : Première brique de `versenco-shared`, un repo dédié aux modules
partagés entre les apps Versenco (SSO et vCaptcha suivront dans des itérations
séparées). Motivation : le client vCoin est aujourd'hui du boilerplate `fetch`
copié-collé par app consommatrice (voir `SSO/VCOIN_INTEGRATION.md`), avec un
vrai risque de fuite du secret serveur si dupliqué sans discipline.

## 1. Objectif et périmètre

Un package TypeScript **public sur npm** (`@versenco/vcoin-client`) qui
encapsule tous les appels aux edge functions `vcoin-*` de versen-connect, avec
une séparation structurelle entre les opérations serveur-à-serveur (secret
d'app) et les opérations côté utilisateur (JWT).

**Public dès la v1, par choix, pas par défaut.** L'objectif final n'est pas
seulement d'arrêter la duplication interne : c'est que des développeurs
externes puissent un jour intégrer le SSO, vCoin (« payer avec vCoin »),
vCaptcha et les futurs emplacements pub VersenAds dans **leurs propres apps**
— comme on intègre un SDK Stripe ou Auth0. `vcoin-client` est le premier
package construit dans cette optique : rien dans son design ne suppose un
consommateur « de confiance » interne à Versenco (voir §3 — aucune méthode
n'embarque de secret qui ne soit pas fourni explicitement par l'appelant).

Publier le SDK maintenant **n'ouvre pas l'accès à l'API** : `vcoin-earn` /
`vcoin-spend` / `vcoin-refund` continuent d'exiger un `client_secret`
provisionné à la main par un admin versen-connect (comme aujourd'hui). Un dev
externe intéressé demande un accès, comme une clé API en bêta privée — aucun
changement côté versen-connect n'est nécessaire pour publier ce package.

**Périmètre v1** : uniquement `vcoin-client`. Pas de SSO, pas de vCaptcha dans
ce repo pour l'instant — ils rejoindront `versenco-shared` dans des plans
séparés une fois ce premier package validé en usage réel. Pas de migration
des apps consommatrices existantes (VersenEducation) — ce plan livre le
package et sa documentation d'intégration, la migration est un travail à part.

## 2. Repo et distribution

- Nouveau repo **`versenco-shared`**, GitHub — **le code source du repo peut
  rester privé** (aucune obligation de l'ouvrir), seul le **package publié
  sur npm** est public. Séparé de `SSO/` (doit être consommable par des repos
  hors `SSO/`, comme VersenEducation, et à terme par des devs externes).
- **Workspace pnpm** dès la v1, prêt à accueillir de futurs packages sans
  réorganisation :
  ```
  versenco-shared/
    pnpm-workspace.yaml
    package.json                # racine, private: true, jamais publié
    packages/
      vcoin-client/
        package.json            # "name": "@versenco/vcoin-client", publishConfig.access: "public"
        src/
        dist/                   # buildé (voir §2.1)
        README.md                # doc publique — un dev externe la lit en premier
        LICENSE                  # MIT (ou équivalent) — requis pour un package public utilisable par des tiers
        vitest.config.ts
  ```
- **§2.1 — Build.** `tsup` en ESM + CJS + `.d.ts`. Un `pnpm publish` construit
  et envoie `dist/` au registre — `dist/` n'a pas besoin d'être committé dans
  git (contrairement à une distribution en dépendance git) ; `.gitignore`
  l'exclut, `.npmignore`/`files` dans `package.json` contrôle ce qui part sur
  npm (`dist/`, `README.md`, `LICENSE`, pas `src/`).
- **Scope npm** : `@versenco` — à réserver (créer l'organisation npm)
  **avant** la première publication, pour sécuriser le nom pour les 3 autres
  packages prévus (SSO, vCaptcha, ads). Vérifié en amont de cette spec :
  aucun package n'existe encore sous ce scope.
- **Versionnage** : semver strict — des inconnus épinglent des versions,
  un breaking change mal versionné casse leur prod. Tags git
  `vcoin-client@X.Y.Z`, `CHANGELOG.md` par package tenu à la main (pas
  d'outillage changesets — un seul package, un seul mainteneur, YAGNI).
- **Publish** : `pnpm publish --access public` depuis `packages/vcoin-client`,
  automatisé en CI sur push de tag (§9), avec provenance npm (OIDC GitHub
  Actions) pour donner à un consommateur externe un signal de build vérifiable
  — pertinent pour un SDK qui touche à de la monnaie.
- **Consommation** :
  ```json
  "dependencies": {
    "@versenco/vcoin-client": "^0.1.0"
  }
  ```
  Rien de spécifique à Versenco côté consommateur — un `pnpm add
  @versenco/vcoin-client` standard, identique à n'importe quel package public.

## 3. Les deux domaines de confiance

Vérifié dans le code réel des edge functions (pas seulement la doc) :

| Fonction | Auth | Où ça peut tourner |
|---|---|---|
| `vcoin-earn`, `vcoin-spend`, `vcoin-refund` | header `x-vcoin-secret` + `app_id` en body | **Serveur uniquement** |
| `vcoin-balance` (chemin secret) | header `x-vcoin-secret` + `x-app-id` + `user_id` (query ou body) | Serveur uniquement |
| `vcoin-config` | aucune (lecture publique) | Serveur (par cohérence d'usage) |
| `vcoin-balance` (chemin JWT), `vcoin-transfer`, `vcoin-create-checkout` | `Authorization: Bearer <access_token utilisateur>` | Navigateur ou serveur, au choix de l'app |

Le package expose **deux clients séparés**, pas un seul avec des méthodes
mixtes : `createVCoinServerClient` (a besoin du secret, ne doit jamais
atterrir dans un bundle navigateur) et `createVCoinUserClient` (sans secret,
prend un `accessToken` par appel). C'est une séparation structurelle : un
fichier qui importe `createVCoinServerClient` et finit dans un composant
`"use client"` est un signal fort de bug, alors qu'avec un client unique rien
ne le distingue d'un import légitime.

## 4. API — `createVCoinServerClient`

```ts
interface VCoinServerConfig {
  appId: string;
  clientSecret: string;
  baseUrl: string; // ex. https://auth.versenco.com — la racine, PAS /functions/v1
}

function createVCoinServerClient(config: VCoinServerConfig): VCoinServerClient;

interface VCoinServerClient {
  earn(input: EarnInput): Promise<VCoinResult<TransactionResult>>;
  spend(input: SpendInput): Promise<VCoinResult<TransactionResult>>;
  refund(input: RefundInput): Promise<VCoinResult<RefundResult>>;
  balance(input: { userId: string }): Promise<VCoinResult<BalanceResult>>;
  getConfig(key?: string): Promise<VCoinResult<{ value: unknown }>>;
}
```

Types d'entrée/sortie, calqués **exactement** sur les contrats réels
(`supabase/functions/vcoin-*/index.ts` et les RPC `vcoin_earn`/`vcoin_spend`/
`vcoin_refund` dans `supabase/migrations/20260413000000_create_vcoin_system.sql`
et `20260502000001_vcoin_packs_and_refund.sql`) :

```ts
type EarnType = "upload_reward" | "welcome_bonus" | "admin_grant" | "referral";
type SpendType = "document_purchase" | "decoration" | "payment" | "admin_deduct";

interface EarnInput {
  userId: string;
  amount: number;          // entier positif, max 10 000 (MAX_AMOUNT côté serveur)
  type: EarnType;
  description?: string;
  referenceId?: string;
  idempotencyKey?: string;
}

interface SpendInput {
  userId: string;
  amount: number;
  type: SpendType;
  description?: string;
  referenceId?: string;
  idempotencyKey?: string;
}

interface TransactionResult {
  balance: number;
  transactionId: string;
  amount: number;
  idempotent?: boolean;    // true si la clé d'idempotence a déjà été traitée (23505)
}

interface RefundInput {
  transactionId: string;
  reason: string;
}

interface RefundResult {
  refundTransactionId: string;
  originalTransactionId: string;
  balance: number;
  amount: number;
}

interface BalanceResult {
  balance: number;
  walletId: string | null;
  updatedAt: string | null;
  transactions: Array<{
    id: string; amount: number; balanceAfter: number; type: string;
    description: string | null; referenceId: string | null; appId: string | null;
    createdAt: string;
  }>;
}
```

`appId` et le header `x-vcoin-secret` sont injectés automatiquement depuis la
config du client sur chaque appel — jamais à fournir par l'appelant.

## 5. API — `createVCoinUserClient`

```ts
interface VCoinUserConfig {
  baseUrl: string;
}

function createVCoinUserClient(config: VCoinUserConfig): VCoinUserClient;

interface VCoinUserClient {
  balance(input: { accessToken: string }): Promise<VCoinResult<BalanceResult>>;
  verifyRecipient(input: { accessToken: string; recipient: string }): Promise<VCoinResult<RecipientInfo>>;
  transfer(input: TransferInput): Promise<VCoinResult<TransferResult>>;
  createCheckout(input: { accessToken: string; packId: string }): Promise<VCoinResult<{ checkoutUrl: string }>>;
}

interface RecipientInfo {
  walletId: string | null;
  name: string;
  avatarUrl: string | null;
}

interface TransferInput {
  accessToken: string;
  recipient: string;       // VRN wallet ID de destinataire (seul format accepté par vcoin-transfer)
  amount: number;           // entier positif, max 2000/24h (DAILY_LIMIT côté serveur)
  description?: string;
  idempotencyKey: string;   // requis — pas de défaut généré côté client pour un transfert d'argent
}

interface TransferResult {
  senderBalance: number;
  recipientWalletId: string;
  txOutId: string;
  txInId: string;
  amount: number;
}
```

`verifyRecipient` appelle `vcoin-transfer` avec `action: "verify"` ; `transfer`
avec `action: "transfer"`. Même endpoint, deux méthodes côté client — le
`action` est un détail d'implémentation caché, pas exposé à l'appelant.

## 6. Gestion des erreurs

Pas d'exception pour les cas métier attendus — retour typé discriminé :

```ts
type VCoinResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "insufficient_balance"; balance: number; required: number }
  | { ok: false; error: "daily_limit_exceeded"; dailySent: number; dailyLimit: number; remaining: number }
  | { ok: false; error: VCoinBusinessError; detail?: string };

type VCoinBusinessError =
  | "wallet_not_found" | "recipient_wallet_not_found" | "invalid_recipient" | "self_transfer"
  | "transaction_not_found" | "already_refunded" | "insufficient_balance_for_refund"
  | "forbidden" | "invalid_token" | "missing_token" | "rate_limited" | "cannot_spend_for_other_user"
  | "admin_deduct_requires_server_credentials" | "config_not_found" | "database_error" | string;
```

Une vraie exception `VCoinNetworkError` (extends `Error`, porte `status?` et
`cause?`) est levée seulement pour l'imprévu : timeout, DNS, 5xx hors les
codes métier ci-dessus, réponse non-JSON.

Chaque appel HTTP passe par un fetcher interne partagé qui :
1. sérialise le body,
2. mappe la réponse HTTP + JSON vers `VCoinResult<T>` (les codes 200/402/403/404
   avec un champ `error` connu deviennent des branches `ok:false` typées ; tout
   le reste devient `VCoinNetworkError`),
3. **ne journalise jamais** `clientSecret` ni `accessToken`, y compris dans les
   messages d'erreur.

## 7. Aide à l'idempotence

```ts
function idempotencyKey(...parts: string[]): string;
```
Concatène les parties avec `_`, tronque/hash si le résultat dépasse une
longueur raisonnable. Remplace les formats ad-hoc actuels
(`upload_${documentId}_${userId}`) par un helper commun.

## 8. Tests

- Vitest, `fetch` mocké (`vi.stubGlobal("fetch", ...)`), un fichier de test
  par méthode de chaque client, calqué sur le style des tests SSO déjà écrits
  dans `versen_ads` (Plan A, tâche 4).
- Un test dédié vérifie que ni `clientSecret` ni `accessToken` n'apparaissent
  dans une URL construite par le client (protection contre une régression qui
  les mettrait en query string plutôt qu'en header).
- Un test de contrat par fonction confirme les noms exacts de header/champ
  body (`x-vcoin-secret`, `app_id` en body — pas en header — pour
  earn/spend/refund ; `x-app-id` en header pour balance) pour éviter une
  dérive silencieuse si l'edge function change.

## 9. CI

GitHub Action sur push de tag `vcoin-client@*` : installe, lint, teste,
build, puis `pnpm publish --access public --provenance` (nécessite un token
npm avec droits de publication sur l'org `@versenco`, stocké en secret
GitHub Actions ; provenance via OIDC — pas de token longue durée à gérer côté
CI pour la signature). Un run qui échoue aux tests ne publie pas.

## 10. Exemple de consommation (documentation, pas du code livré ici)

```ts
// app/api/documents/[id]/approve/route.ts (VersenEducation, migration future)
import { createVCoinServerClient, idempotencyKey } from "@versenco/vcoin-client";

const vcoin = createVCoinServerClient({
  appId: "versen-education",
  clientSecret: process.env.VCOIN_CLIENT_SECRET!,
  baseUrl: process.env.VERSEN_CONNECT_URL!,
});

const result = await vcoin.earn({
  userId, amount: 50, type: "upload_reward",
  description: `Uploaded "${documentTitle}"`, referenceId: documentId,
  idempotencyKey: idempotencyKey("upload", documentId, userId),
});
if (!result.ok) { /* gérer selon result.error */ }
```

## 11. Hors périmètre v1

- SSO et vCaptcha dans `versenco-shared` — plans séparés, plus tard.
- Migration des apps consommatrices existantes (VersenEducation, versen-pay,
  sovereign-connect) — travail séparé, une fois le package publié.
- Portail self-serve pour que des devs externes obtiennent eux-mêmes un
  `client_secret` — reste un provisioning manuel par un admin versen-connect,
  comme pour les apps maison aujourd'hui (voir §1).
- Retry automatique / backoff sur `VCoinNetworkError` — l'appelant décide.
- Validation de schéma runtime (zod) sur les réponses serveur — les types
  TS suffisent pour la confiance qu'on a dans versen-connect comme source ;
  à reconsidérer si versen-connect change sans coordination.
- Documentation publique complète (site de docs, guides par langage/framework)
  — v1 se limite à un `README.md` correct dans le package.

## 12. Prochaines étapes

1. Revue de cette spec.
2. Passage au plan d'implémentation détaillé (skill `writing-plans`).

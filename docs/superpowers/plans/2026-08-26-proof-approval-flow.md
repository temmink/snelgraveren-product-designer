# Proefdruk- en goedkeuringsstroom — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De winkelier stuurt een zelfgemaakt ontwerp als proefdruk naar een klant; die keurt het goed (en bestelt) of vraagt een wijziging aan, zonder account en zonder de designer te openen.

**Architecture:** De proefdruk is een serverside gerenderde pagina die de ópgeslagen render toont (`wp_pf_design_views.thumbnail` / `export_svg`), geen Fabric-canvas — wat de klant goedkeurt is dan letterlijk het bestand dat de productie krijgt. Toegang loopt via een CSPRNG-token op de ontwerp-rij, los van `design_hash`. Alle toestandsovergangen leven in één klasse, `Proof\ProofWorkflow`; de pagina- en adminlagen bevatten geen eigen regels over wat mag.

**Tech Stack:** PHP 8.1+, WordPress, WooCommerce (`WC_Email`, WC-sessie, cart), custom `wp_pf_*`-tabellen via Repository-klassen, PHPUnit tegen een echte WordPress-bootstrap in Docker.

**Spec:** `docs/superpowers/specs/2026-08-26-proof-approval-flow-design.md`

## Global Constraints

- Namespace `Snelgraveren\ProductDesigner\`, sub-namespace per map. Bestandsnaam `class-{lowercase-hyphenated}.php` (`ProofWorkflow` → `class-proof-workflow.php`).
- In élk PHP-bestand komt `namespace` vóór `defined('ABSPATH') || exit;`.
- Alle databasetoegang via Repository-klassen in `includes/Database/`; nooit `$wpdb` daarbuiten.
- Alle queries via `$wpdb->prepare()`, zonder uitzondering.
- Publieke ontwerp-identifiers zijn CSPRNG-hashes (`bin2hex(random_bytes(16))`), nooit oplopende ID's.
- Tekstdomein `snelgraveren-product-designer`. Bronstrings in het Engels.
- Pro-functie: feature-sleutel `proofs`, servercode gestript uit de gratis build via `@fs_premium_only`.
- Testen draaien in Docker: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit"`. De pluginmap heet in de container `productforge`, niet de slug.
- Lint: `docker compose exec -T wordpress php -l /var/www/html/wp-content/plugins/productforge/<pad>`.

---

### Task 1: Migratie 1100 en de proefdrukvelden in de repository

**Files:**
- Create: `includes/Database/class-migration1100.php`
- Modify: `includes/Database/class-db-manager.php:11-22` (migratielijst)
- Modify: `includes/Database/class-design-repository.php` (nieuwe methodes onder `assign_customer()`)
- Test: `tests/php/Database/DesignRepositoryTest.php`

**Interfaces:**
- Consumes: niets (eerste taak)
- Produces:
  - `DesignRepository::get_by_proof_token(string $token): ?array`
  - `DesignRepository::update_proof(int $id, array $fields): bool` — toegestane sleutels `proof_status`, `proof_token`, `proof_sent_at`, `proof_note`, `proof_email`
  - Kolommen `proof_status`, `proof_token`, `proof_sent_at`, `proof_note`, `proof_email` op `wp_pf_designs`

- [ ] **Step 1: Schrijf de falende test**

Toevoegen aan `tests/php/Database/DesignRepositoryTest.php`, vóór `tearDown()`:

```php
    public function test_update_proof_writes_only_whitelisted_fields(): void {
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;

        $this->assertTrue($this->repo->update_proof($id, [
            'proof_status' => 'sent',
            'proof_token'  => str_repeat('b', 32),
            'proof_note'   => 'Naam mag groter',
            'proof_email'  => 'klant@example.invalid',
            'status'       => 'ordered',   // niet in de whitelist: moet genegeerd worden
        ]));

        $design = $this->repo->get($id);
        $this->assertSame('sent', $design['proof_status']);
        $this->assertSame(str_repeat('b', 32), $design['proof_token']);
        $this->assertSame('Naam mag groter', $design['proof_note']);
        $this->assertSame('klant@example.invalid', $design['proof_email']);
        // status hoort NIET meegewijzigd te zijn: proefdruk en levenscyclus zijn
        // aparte assen, en update_proof mag de tweede niet kunnen verzetten.
        $this->assertSame('draft', $design['status']);
    }

    public function test_get_by_proof_token_finds_the_design(): void {
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        $token = str_repeat('c', 32);
        $this->repo->update_proof($id, ['proof_token' => $token, 'proof_status' => 'sent']);

        $found = $this->repo->get_by_proof_token($token);
        $this->assertNotNull($found);
        $this->assertSame((int) $id, (int) $found['id']);
    }

    public function test_get_by_proof_token_ignores_an_empty_token(): void {
        // Elke rij zonder proefdruk heeft proof_token = ''. Een lege zoekterm
        // mag daarom nooit een willekeurig ontwerp opleveren.
        $this->assertNull($this->repo->get_by_proof_token(''));
    }
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter DesignRepositoryTest"`
Expected: FAIL — `Call to undefined method ... ::update_proof()`

- [ ] **Step 3: Schrijf de migratie**

Nieuw bestand `includes/Database/class-migration1100.php`:

```php
<?php
namespace Snelgraveren\ProductDesigner\Database;

defined('ABSPATH') || exit;

/**
 * Migration 1100: proof/approval state on designs.
 *
 * A design's `status` column describes its production lifecycle
 * (draft/final/ordered/archived). A proof is a PARALLEL state, not a phase of
 * that one — an approved proof is still a draft until the order lands — so it
 * gets its own column rather than new enum values.
 *
 * proof_token is generated separately from design_hash on purpose: the hash
 * leaks into cart URLs and order item meta, so it must never grant access.
 */
class Migration1100 {

    public function up(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'pf_designs';

        $columns = [
            'proof_status'  => "ALTER TABLE `{$table}` ADD COLUMN `proof_status` ENUM('none','sent','changes_requested','approved') NOT NULL DEFAULT 'none' AFTER `status`",
            'proof_token'   => "ALTER TABLE `{$table}` ADD COLUMN `proof_token` CHAR(32) NOT NULL DEFAULT '' AFTER `proof_status`",
            'proof_sent_at' => "ALTER TABLE `{$table}` ADD COLUMN `proof_sent_at` DATETIME NULL DEFAULT NULL AFTER `proof_token`",
            'proof_note'    => "ALTER TABLE `{$table}` ADD COLUMN `proof_note` TEXT NULL DEFAULT NULL AFTER `proof_sent_at`",
            // A proof may go to someone with NO account — that is a premise of
            // the flow — so the address cannot be looked up from customer_id.
            'proof_email'   => "ALTER TABLE `{$table}` ADD COLUMN `proof_email` VARCHAR(191) NOT NULL DEFAULT '' AFTER `proof_note`",
        ];

        foreach ($columns as $name => $sql) {
            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s",
                DB_NAME, $table, $name
            ));
            if (!$exists) {
                // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal, statements are literals above
                $wpdb->query($sql);
            }
        }

        $index = $wpdb->get_var($wpdb->prepare(
            "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND INDEX_NAME = 'proof_token'",
            DB_NAME, $table
        ));
        if (!$index) {
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal
            $wpdb->query("ALTER TABLE `{$table}` ADD KEY `proof_token` (`proof_token`)");
        }
    }
}
```

- [ ] **Step 4: Registreer de migratie**

In `includes/Database/class-db-manager.php`, in de `$migrations`-array na `1000 => Migration1000::class,`:

```php
            1100 => Migration1100::class,
```

- [ ] **Step 5: Schrijf de repository-methodes**

In `includes/Database/class-design-repository.php`, direct onder `assign_customer()`:

```php
    /** Fields update_proof() may write. Nothing else, ever. */
    private const PROOF_FIELDS = ['proof_status', 'proof_token', 'proof_sent_at', 'proof_note', 'proof_email'];

    /**
     * Write proof fields on a design.
     *
     * The whitelist is the point: proof state and the design's production
     * `status` are separate axes, and a caller reaching for one must not be
     * able to move the other by passing an extra key.
     */
    public function update_proof(int $id, array $fields): bool {
        global $wpdb;

        $data    = [];
        $formats = [];
        foreach (self::PROOF_FIELDS as $field) {
            if (!array_key_exists($field, $fields)) {
                continue;
            }
            $data[$field]  = $fields[$field] === null ? null : (string) $fields[$field];
            $formats[]     = '%s';
        }
        if (!$data) {
            return false;
        }

        $hash = $wpdb->get_var($wpdb->prepare("SELECT design_hash FROM {$this->table} WHERE id = %d", $id));
        if (!$hash) {
            return false;
        }

        $result = $wpdb->update($this->table, $data, ['id' => $id], $formats, ['%d']);
        $this->invalidate_cache((string) $hash);
        return $result !== false;
    }

    /**
     * Look a design up by its proof token.
     *
     * An empty token matches nothing: every design without a proof carries
     * proof_token = '', so an empty needle would otherwise hand out an
     * arbitrary design to anyone who trims the parameter off the URL.
     */
    public function get_by_proof_token(string $token): ?array {
        if (!preg_match('/^[0-9a-f]{32}$/', $token)) {
            return null;
        }

        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$this->table} WHERE proof_token = %s", $token),
            ARRAY_A
        );
        if (!$row) {
            return null;
        }
        $row['views'] = $this->get_views((int) $row['id']);
        return $row;
    }
```

- [ ] **Step 6: Draai de migratie en de tests**

Run:
```bash
docker compose exec -T wordpress wp eval 'Snelgraveren\ProductDesigner\Database\DbManager::run_migrations();' --path=/var/www/html --allow-root
docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter DesignRepositoryTest"
```
Expected: PASS, en `wp db query "DESCRIBE wp_pf_designs"` toont de vijf kolommen.

Let op: `test_get_by_proof_token_ignores_an_empty_token` slaagt door de `preg_match` — een lege string is geen 32 hex.

- [ ] **Step 7: Commit**

```bash
git add includes/Database/class-migration1100.php includes/Database/class-db-manager.php includes/Database/class-design-repository.php tests/php/Database/DesignRepositoryTest.php
git commit -m "feat(db): proof state columns on designs

proof_status is a parallel axis to the design's production status, not a
phase of it: an approved proof is still a draft until the order lands.
proof_token is generated separately from design_hash because the hash leaks
into cart URLs and order item meta and must never grant access."
```

---

### Task 2: ProofWorkflow — de toestandsmachine

**Files:**
- Create: `includes/Proof/class-proof-workflow.php`
- Test: `tests/php/Proof/ProofWorkflowTest.php`

**Interfaces:**
- Consumes: `DesignRepository::update_proof()`, `DesignRepository::get()`, `DesignRepository::get_by_proof_token()`
- Produces:
  - `ProofWorkflow::STATES` (array), `ProofWorkflow::ACTIONS` (array)
  - `ProofWorkflow::allows(string $from, string $action): bool`
  - `ProofWorkflow::send(int $design_id): string` — geeft het token terug, gooit `\RuntimeException` bij onbekend ontwerp
  - `ProofWorkflow::approve(string $token): array` — geeft de ontwerp-rij terug
  - `ProofWorkflow::request_changes(string $token, string $note): array`
  - `ProofWorkflow::withdraw(int $design_id): bool`

Mails en winkelwagen zitten hier **niet** in; die haken in latere taken op deze methodes aan. Deze klasse kent alleen toestanden.

- [ ] **Step 1: Schrijf de falende test**

Nieuw bestand `tests/php/Proof/ProofWorkflowTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\DesignRepository;
use Snelgraveren\ProductDesigner\Proof\ProofWorkflow;

class ProofWorkflowTest extends TestCase {
    private DesignRepository $repo;
    private ProofWorkflow $flow;
    private array $created_ids = [];

    protected function setUp(): void {
        $this->repo = new DesignRepository();
        $this->flow = new ProofWorkflow($this->repo);
    }

    private function make_design(): int {
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'proof-test-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        return $id;
    }

    public function test_send_generates_a_token_and_moves_to_sent(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);

        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $token);
        $design = $this->repo->get($id);
        $this->assertSame('sent', $design['proof_status']);
        $this->assertNotEmpty($design['proof_sent_at']);
        // Het token mag NOOIT de design_hash zijn: die lekt in cart-URL's.
        $this->assertNotSame($design['design_hash'], $token);
    }

    public function test_resending_keeps_the_same_token(): void {
        // De klant heeft de eerste link al in zijn mailbox; een nieuwe versie
        // sturen mag die link niet doodmaken.
        $id     = $this->make_design();
        $first  = $this->flow->send($id);
        $this->flow->request_changes($first, 'Groter graag');
        $second = $this->flow->send($id);

        $this->assertSame($first, $second);
    }

    public function test_approve_moves_sent_to_approved(): void {
        $id     = $this->make_design();
        $token  = $this->flow->send($id);
        $design = $this->flow->approve($token);

        $this->assertSame('approved', $design['proof_status']);
        $this->assertSame((int) $id, (int) $design['id']);
    }

    public function test_approving_twice_is_not_an_error(): void {
        // Een tweede klik op de knop in een oude tab mag geen foutpagina geven.
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->flow->approve($token);

        $design = $this->flow->approve($token);
        $this->assertSame('approved', $design['proof_status']);
    }

    public function test_request_changes_stores_the_note(): void {
        $id     = $this->make_design();
        $token  = $this->flow->send($id);
        $design = $this->flow->request_changes($token, '  De naam mag groter  ');

        $this->assertSame('changes_requested', $design['proof_status']);
        $this->assertSame('De naam mag groter', $design['proof_note']);
    }

    public function test_request_changes_is_refused_once_approved(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->flow->approve($token);

        $this->expectException(\RuntimeException::class);
        $this->flow->request_changes($token, 'Toch anders');
    }

    public function test_withdraw_kills_the_link(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);

        $this->assertTrue($this->flow->withdraw($id));
        $this->assertNull($this->repo->get_by_proof_token($token));
        $this->assertSame('none', $this->repo->get($id)['proof_status']);
    }

    public function test_an_unknown_token_is_refused(): void {
        $this->expectException(\RuntimeException::class);
        $this->flow->approve(str_repeat('f', 32));
    }

    public function test_allows_matches_the_transition_table(): void {
        $this->assertTrue(ProofWorkflow::allows('none', 'send'));
        $this->assertTrue(ProofWorkflow::allows('changes_requested', 'send'));
        $this->assertTrue(ProofWorkflow::allows('approved', 'send'));
        $this->assertTrue(ProofWorkflow::allows('sent', 'approve'));
        $this->assertTrue(ProofWorkflow::allows('sent', 'request_changes'));
        $this->assertFalse(ProofWorkflow::allows('none', 'approve'));
        $this->assertFalse(ProofWorkflow::allows('none', 'request_changes'));
        $this->assertFalse(ProofWorkflow::allows('approved', 'request_changes'));
        $this->assertFalse(ProofWorkflow::allows('sent', 'nonsense'));
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
        $this->created_ids = [];
    }
}
```

Aanvullend vereist (uit de review van deze taak): een test dat een note langer dan `MAX_NOTE` op exact die lengte wordt afgekapt; dat `approve()` en `request_changes()` óók geweigerd worden vanuit `none` en `changes_requested`; dat `withdraw()` werkt vanuit `none` en `approved`; dat `request_changes()` met een onbekend token gooit; dat `withdraw()` op een onbekend design-id gooit; en `assertTrue(ProofWorkflow::allows('sent', 'send'))` — opnieuw sturen vanuit `sent` is toegestaan en moet expliciet vastliggen.

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter ProofWorkflowTest"`
Expected: FAIL — `Class "Snelgraveren\ProductDesigner\Proof\ProofWorkflow" not found`

- [ ] **Step 3: Schrijf de klasse**

Nieuw bestand `includes/Proof/class-proof-workflow.php`:

```php
<?php
namespace Snelgraveren\ProductDesigner\Proof;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Database\DesignRepository;

/**
 * Every proof state transition, in one place.
 *
 * The page layer and the admin layer call these methods; neither carries its
 * own opinion about what is allowed. A second place that decides is a second
 * place that can disagree — the whole reason this class exists.
 *
 * Mail and cart are NOT here. Callers compose them, so the state machine stays
 * testable without WooCommerce.
 */
class ProofWorkflow {

    public const STATES  = ['none', 'sent', 'changes_requested', 'approved'];
    public const ACTIONS = ['send', 'approve', 'request_changes', 'withdraw'];

    /** Longest change request we store, in characters. */
    public const MAX_NOTE = 1000;

    /** from-state => actions permitted from it. */
    private const TABLE = [
        'none'              => ['send', 'withdraw'],
        'sent'              => ['approve', 'request_changes', 'send', 'withdraw'],
        'changes_requested' => ['send', 'withdraw'],
        'approved'          => ['send', 'withdraw'],
    ];

    private DesignRepository $repo;

    public function __construct(?DesignRepository $repo = null) {
        $this->repo = $repo ?: new DesignRepository();
    }

    public static function allows(string $from, string $action): bool {
        return in_array($action, self::TABLE[$from] ?? [], true);
    }

    /**
     * Send (or re-send) the proof. Returns the token to put in the link.
     *
     * An existing token is REUSED: the customer already has the first link in
     * their mailbox, and sending them a new version must not kill it.
     */
    public function send(int $design_id): string {
        $design = $this->repo->get($design_id);
        if (!$design) {
            throw new \RuntimeException('Design not found.', 404);
        }
        $this->assert($design['proof_status'], 'send');

        $token = (string) $design['proof_token'];
        if (!preg_match('/^[0-9a-f]{32}$/', $token)) {
            $token = bin2hex(random_bytes(16));
        }

        $this->repo->update_proof($design_id, [
            'proof_status'  => 'sent',
            'proof_token'   => $token,
            'proof_sent_at' => current_time('mysql'),
        ]);

        return $token;
    }

    /** @return array The design row, after the transition. */
    public function approve(string $token): array {
        $design = $this->by_token($token);

        // Already approved: a second click on a stale tab is not a mistake to
        // report, it is the customer confirming what they already said.
        if ($design['proof_status'] === 'approved') {
            return $design;
        }

        $this->assert($design['proof_status'], 'approve');
        $this->repo->update_proof((int) $design['id'], ['proof_status' => 'approved']);

        return $this->repo->get((int) $design['id']);
    }

    /** @return array The design row, after the transition. */
    public function request_changes(string $token, string $note): array {
        $design = $this->by_token($token);
        $this->assert($design['proof_status'], 'request_changes');

        $clean = trim(sanitize_textarea_field($note));
        if (function_exists('mb_substr')) {
            $clean = mb_substr($clean, 0, self::MAX_NOTE);
        } else {
            $clean = substr($clean, 0, self::MAX_NOTE);
        }

        $this->repo->update_proof((int) $design['id'], [
            'proof_status' => 'changes_requested',
            'proof_note'   => $clean,
        ]);

        return $this->repo->get((int) $design['id']);
    }

    /** Kill the link. The token is wiped, so the URL resolves to nothing. */
    public function withdraw(int $design_id): bool {
        return $this->repo->update_proof($design_id, [
            'proof_status' => 'none',
            'proof_token'  => '',
        ]);
    }

    private function by_token(string $token): array {
        $design = $this->repo->get_by_proof_token($token);
        if (!$design) {
            throw new \RuntimeException('Proof not found.', 404);
        }
        return $design;
    }

    private function assert(string $from, string $action): void {
        if (!self::allows($from, $action)) {
            throw new \RuntimeException(
                sprintf('Cannot %s a proof in state %s.', $action, $from),
                409
            );
        }
    }
}
```

- [ ] **Step 4: Draai de tests**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter ProofWorkflowTest"`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add includes/Proof/class-proof-workflow.php tests/php/Proof/ProofWorkflowTest.php
git commit -m "feat(proof): the proof state machine, and nothing else

Every transition in one class, with mail and cart deliberately left out so
the rules stay testable without WooCommerce. Re-sending reuses the existing
token: the customer already has the first link in their mailbox."
```

---

### Task 3: De opruimcron mag een proefdruk niet opeten

**Files:**
- Modify: `includes/Database/class-design-repository.php` (`find_stale_guest_drafts()`, de WHERE-clausule)
- Test: `tests/php/Database/DesignRepositoryTest.php`

**Interfaces:**
- Consumes: kolom `proof_status` uit Task 1
- Produces: niets nieuws — gedragswijziging van een bestaande methode

Dit is geen randgeval maar het normale geval: "geen account nodig" is een uitgangspunt van het ontwerp, dus een proefdruk naar iemand zonder account is exact een `customer_id = 0`-gastconcept, en die worden na 30 dagen verwijderd — mét de link die de klant nog heeft.

- [ ] **Step 1: Schrijf de falende test**

Toevoegen aan `tests/php/Database/DesignRepositoryTest.php`:

```php
    public function test_stale_guest_drafts_skips_a_design_with_a_proof(): void {
        global $wpdb;

        $with    = $this->make_stale_guest_draft();
        $without = $this->make_stale_guest_draft();
        $this->repo->update_proof($with, [
            'proof_status' => 'sent',
            'proof_token'  => bin2hex(random_bytes(16)),
        ]);
        // Re-age AFTER update_proof(): updated_at is ON UPDATE CURRENT_TIMESTAMP,
        // so writing the proof fields makes the row fresh again. Without this the
        // test passes even with the exclusion deleted — it would be measuring
        // freshness, not the proof.
        $this->age_design($with);

        $ids = array_map('intval', array_column($this->repo->find_stale_guest_drafts(30), 'id'));

        $this->assertContains((int) $without, $ids, 'a plain stale guest draft is still collected');
        $this->assertNotContains((int) $with, $ids, 'a design with a proof must survive the cron');
    }

    /** Push a design's updated_at past any retention window. */
    private function age_design(int $id): void {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "UPDATE {$wpdb->prefix}pf_designs SET updated_at = DATE_SUB(NOW(), INTERVAL 90 DAY) WHERE id = %d",
            $id
        ));
    }

    /** A guest draft old enough for the cleanup cron to collect. */
    private function make_stale_guest_draft(): int {
        global $wpdb;
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'stale-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        // updated_at is ON UPDATE CURRENT_TIMESTAMP, so age it explicitly.
        $wpdb->query($wpdb->prepare(
            "UPDATE {$wpdb->prefix}pf_designs SET updated_at = DATE_SUB(NOW(), INTERVAL 90 DAY) WHERE id = %d",
            $id
        ));
        return $id;
    }
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter test_stale_guest_drafts_skips_a_design_with_a_proof"`
Expected: FAIL — "a design with a proof must survive the cron"

- [ ] **Step 3: Voeg de uitzondering toe aan de query**

In `includes/Database/class-design-repository.php`, in `find_stale_guest_drafts()`, direct na `AND d.status = 'draft'`:

```php
               AND d.proof_status = 'none'
```

En vul de docblock van de methode aan met de reden:

```php
     * Designs with a proof are excluded regardless of age: a proof sent to
     * someone WITHOUT an account is exactly a customer_id = 0 guest draft, and
     * deleting it would kill the link still sitting in their mailbox.
```

- [ ] **Step 4: Draai de tests**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter DesignRepositoryTest"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add includes/Database/class-design-repository.php tests/php/Database/DesignRepositoryTest.php
git commit -m "fix(cleanup): a design with a proof is never a stale guest draft

A proof sent to someone without an account IS a customer_id = 0 guest draft,
and 'no account needed' is a premise of the proof flow — so this is the normal
case, not an edge case. The cron would have deleted the design a month later,
together with the link still in the customer's mailbox."
```

---

### Task 4: De sessiebrug in `Frontend::owns_design()`

**Files:**
- Create: `includes/Proof/class-proof-session.php`
- Modify: `includes/Frontend/class-frontend.php:89-107` (`owns_design()` + docblock)
- Modify: `includes/API/class-rest-designs.php:105-118` (alleen de docblock van `owns_design()`)
- Test: `tests/php/Proof/ProofSessionTest.php`

**Interfaces:**
- Consumes: niets uit eerdere taken
- Produces:
  - `ProofSession::mark_approved(string $hash): void`
  - `ProofSession::is_approved(string $hash): bool`
  - `ProofSession::forget(string $hash): void`

- [ ] **Step 1: Schrijf de falende test**

Nieuw bestand `tests/php/Proof/ProofSessionTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Proof\ProofSession;

class ProofSessionTest extends TestCase {

    protected function setUp(): void {
        if (!function_exists('WC') || !WC()->session) {
            $this->markTestSkipped('WooCommerce session not available in this context.');
        }
        WC()->session->set(ProofSession::KEY, []);
    }

    public function test_an_unknown_hash_is_not_approved(): void {
        $this->assertFalse(ProofSession::is_approved(str_repeat('a', 32)));
    }

    public function test_marking_a_hash_approves_it_for_this_session(): void {
        $hash = str_repeat('a', 32);
        ProofSession::mark_approved($hash);

        $this->assertTrue(ProofSession::is_approved($hash));
        $this->assertFalse(ProofSession::is_approved(str_repeat('b', 32)));
    }

    public function test_marking_twice_does_not_duplicate(): void {
        $hash = str_repeat('a', 32);
        ProofSession::mark_approved($hash);
        ProofSession::mark_approved($hash);

        $this->assertSame([$hash], WC()->session->get(ProofSession::KEY));
    }

    public function test_forget_removes_the_hash(): void {
        $hash = str_repeat('a', 32);
        ProofSession::mark_approved($hash);
        ProofSession::forget($hash);

        $this->assertFalse(ProofSession::is_approved($hash));
    }

    public function test_a_malformed_hash_is_never_stored(): void {
        ProofSession::mark_approved('not-a-hash');
        $this->assertFalse(ProofSession::is_approved('not-a-hash'));
    }
}
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter ProofSessionTest"`
Expected: FAIL — `Class "Snelgraveren\ProductDesigner\Proof\ProofSession" not found`

- [ ] **Step 3: Schrijf de klasse**

Nieuw bestand `includes/Proof/class-proof-session.php`:

```php
<?php
namespace Snelgraveren\ProductDesigner\Proof;

defined('ABSPATH') || exit;

/**
 * Which designs THIS visitor has approved a proof for.
 *
 * The proof link needs no login, so at the moment of approving there is no
 * customer_id and no guest design session to match on. This list is the
 * evidence that the visitor holding the browser is the one who approved, and
 * it is what Frontend::owns_design() consults so add-to-cart keeps the hash.
 *
 * Lives in the WooCommerce session, so it dies with the session and is never
 * written to the database — a stored grant would outlive the visit.
 */
class ProofSession {

    public const KEY = 'sgpd_proof_approved';

    private static function available(): bool {
        return function_exists('WC') && WC() && WC()->session;
    }

    /** @return string[] */
    private static function all(): array {
        if (!self::available()) {
            return [];
        }
        $list = WC()->session->get(self::KEY);
        return is_array($list) ? $list : [];
    }

    public static function mark_approved(string $hash): void {
        if (!preg_match('/^[0-9a-f]{32}$/', $hash) || !self::available()) {
            return;
        }
        $list = self::all();
        if (!in_array($hash, $list, true)) {
            $list[] = $hash;
            WC()->session->set(self::KEY, $list);
        }
    }

    public static function is_approved(string $hash): bool {
        if (!preg_match('/^[0-9a-f]{32}$/', $hash)) {
            return false;
        }
        return in_array($hash, self::all(), true);
    }

    public static function forget(string $hash): void {
        if (!self::available()) {
            return;
        }
        $list = array_values(array_filter(self::all(), static fn ($h) => $h !== $hash));
        WC()->session->set(self::KEY, $list);
    }
}
```

- [ ] **Step 4: Haak hem in `Frontend::owns_design()`**

In `includes/Frontend/class-frontend.php`, vervang de docblock en het slot van `owns_design()`:

```php
    /**
     * Mirrors Snelgraveren\ProductDesigner\API\RestDesigns::owns_design(): the current
     * requester must be the design's logged-in customer, or hold the same
     * guest session id the design was saved under, or be able to manage
     * templates (admins/shop managers legitimately reassigning designs).
     *
     * ONE DELIBERATE DIVERGENCE from that mirror: a visitor who approved this
     * design's proof in this WooCommerce session also owns it here. The proof
     * link needs no login, so without this the approve-to-cart step would hit
     * the silent hash drop. It is added HERE ONLY — the proof page is rendered
     * server-side and never touches the REST layer, so RestDesigns stays as
     * strict as it was.
     */
    private function owns_design(array $design): bool {
        $user_id = get_current_user_id();
        if ($user_id && (int) $design['customer_id'] === $user_id) {
            return true;
        }

        $session_id = \Snelgraveren\ProductDesigner\Security\CapabilityChecker::current_session_id();
        if (!empty($session_id) && $design['session_id'] === $session_id) {
            return true;
        }

        if (class_exists(\Snelgraveren\ProductDesigner\Proof\ProofSession::class)
            && \Snelgraveren\ProductDesigner\Proof\ProofSession::is_approved((string) $design['design_hash'])) {
            return true;
        }

        return current_user_can('edit_sgpd_templates');
    }
```

De `class_exists()` is nodig omdat `includes/Proof/` uit de gratis build gestript wordt (Task 11).

- [ ] **Step 5: Noteer de afwijking ook aan de REST-kant**

In `includes/API/class-rest-designs.php`, boven `owns_design()`:

```php
    /**
     * Mirrored in Frontend::owns_design(), with ONE deliberate difference: the
     * frontend also accepts a design whose proof was approved in this
     * WooCommerce session. That clause is NOT here. The proof page renders
     * server-side and never calls this API, so widening it would buy nothing
     * and cost the strictness this route has.
     */
```

- [ ] **Step 6: Draai de tests**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit"`
Expected: PASS (ProofSessionTest kan `skipped` melden als er geen WC-sessie is in de CLI-context — dat is correct gedrag, geen fout).

- [ ] **Step 7: Commit**

```bash
git add includes/Proof/class-proof-session.php includes/Frontend/class-frontend.php includes/API/class-rest-designs.php tests/php/Proof/ProofSessionTest.php
git commit -m "feat(proof): session-scoped ownership for an approved proof

The proof link needs no login, so at the moment of approving there is no
customer_id and no guest design session to match on. The approval is recorded
in the WooCommerce session and Frontend::owns_design() honours it, so
add-to-cart keeps the hash instead of silently dropping it.

Added to the frontend mirror ONLY. The proof page renders server-side and
never calls the REST route, so RestDesigns keeps its original strictness; both
docblocks now name the divergence and why."
```

---

### Task 5: De proefdrukpagina — routering en weergave

**Files:**
- Create: `includes/Proof/class-proof-page.php`
- Create: `templates/proof/proof-page.php`
- Modify: `includes/class-plugin.php` (registratie naast de andere frontend-onderdelen)
- Test: `tests/php/Proof/ProofPageTest.php`

**Interfaces:**
- Consumes: `DesignRepository::get_by_proof_token()`, `ProofWorkflow`
- Produces:
  - `ProofPage::init(): void`
  - `ProofPage::url(string $token): string`
  - `ProofPage::token_from_request(): string`

Alleen weergave in deze taak. De twee knoppen komen in Task 7 en 8.

- [ ] **Step 1: Schrijf de falende test**

Nieuw bestand `tests/php/Proof/ProofPageTest.php`:

```php
<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Proof\ProofPage;

class ProofPageTest extends TestCase {

    protected function tearDown(): void {
        unset($_GET['sgpd_proof']);
    }

    public function test_url_carries_the_token(): void {
        $token = str_repeat('a', 32);
        $this->assertStringContainsString('sgpd_proof=' . $token, ProofPage::url($token));
    }

    public function test_token_from_request_accepts_a_well_formed_token(): void {
        $_GET['sgpd_proof'] = str_repeat('a', 32);
        $this->assertSame(str_repeat('a', 32), ProofPage::token_from_request());
    }

    public function test_token_from_request_rejects_anything_else(): void {
        // A malformed token must resolve to '' and never reach the repository,
        // where a LIKE or a loose comparison could match a real row.
        foreach (['', 'nope', str_repeat('a', 31), str_repeat('a', 33), 'AAAA' . str_repeat('a', 28), '../../etc'] as $bad) {
            $_GET['sgpd_proof'] = $bad;
            $this->assertSame('', ProofPage::token_from_request(), "rejected: {$bad}");
        }
    }

    public function test_token_from_request_is_empty_without_the_parameter(): void {
        unset($_GET['sgpd_proof']);
        $this->assertSame('', ProofPage::token_from_request());
    }
}
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter ProofPageTest"`
Expected: FAIL — class not found

- [ ] **Step 3: Schrijf de pagina-klasse**

Nieuw bestand `includes/Proof/class-proof-page.php`:

```php
<?php
namespace Snelgraveren\ProductDesigner\Proof;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Database\DesignRepository;

/**
 * The customer-facing proof page.
 *
 * A QUERY PARAMETER, not a rewrite endpoint, on purpose: add_rewrite_endpoint()
 * needs a flush_rewrite_rules(), and a flush at the wrong moment has already
 * 404'd this shop's category pages once (CLAUDE.md -> Deployment). A query var
 * needs no rules and so can break nothing.
 *
 * Renders the STORED render — the file production gets — not a fresh Fabric
 * canvas. A re-render in the customer's browser is not guaranteed to match:
 * 1.3.5 was exactly that, a Google font that failed to load on live and text
 * that came out skewed. A proof that re-renders lets the customer approve
 * something other than what is made.
 */
class ProofPage {

    public const QUERY_VAR = 'sgpd_proof';

    public function init(): void {
        add_action('template_redirect', [$this, 'maybe_render'], 5);
    }

    public static function url(string $token): string {
        return add_query_arg(self::QUERY_VAR, $token, home_url('/'));
    }

    /** The token from the URL, or '' when it is absent or malformed. */
    public static function token_from_request(): string {
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only navigation param; the token IS the credential
        $raw = isset($_GET[self::QUERY_VAR]) ? wp_unslash($_GET[self::QUERY_VAR]) : '';
        if (!is_string($raw) || !preg_match('/^[0-9a-f]{32}$/', $raw)) {
            return '';
        }
        return $raw;
    }

    public function maybe_render(): void {
        $token = self::token_from_request();
        if ($token === '') {
            return;
        }

        // Same reasoning as the designer page: this page is per-visitor, and a
        // publicly cached copy would show one customer another's design.
        if (!defined('DONOTCACHEPAGE')) {
            define('DONOTCACHEPAGE', true);
        }
        do_action('litespeed_control_set_nocache', 'ProductForge proof page (per-customer design)');

        $design = (new DesignRepository())->get_by_proof_token($token);

        status_header($design ? 200 : 410);
        nocache_headers();

        include SGPD_PLUGIN_DIR . 'templates/proof/proof-page.php';
        exit;
    }
}
```

- [ ] **Step 4: Schrijf het sjabloon**

Nieuw bestand `templates/proof/proof-page.php`:

```php
<?php
/**
 * Proof page template.
 *
 * Available: $design (array|null), $token (string).
 * Standalone document: the customer may not be logged in and may open this on
 * a phone, so it carries its own minimal styling instead of booting the theme.
 */

namespace Snelgraveren\ProductDesigner\Proof;

defined('ABSPATH') || exit;

$product = $design ? wc_get_product((int) $design['product_id']) : null;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title><?php esc_html_e('Your proof', 'snelgraveren-product-designer'); ?></title>
    <style>
        .pf-proof { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1d2327; background: #f6f7f7; }
        .pf-proof * { box-sizing: border-box; }
        .pf-proof__inner { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
        .pf-proof__card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
        .pf-proof__view { display: block; max-width: 100%; height: auto; margin: 0 auto 8px; }
        .pf-proof__title { font-size: 20px; margin: 0 0 4px; }
        .pf-proof__price { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
    </style>
</head>
<body class="pf-proof">
<div class="pf-proof__inner">

<?php if (!$design) : ?>
    <div class="pf-proof__card">
        <h1 class="pf-proof__title"><?php esc_html_e('This proof is no longer valid', 'snelgraveren-product-designer'); ?></h1>
        <p><?php esc_html_e('The link has expired or was withdrawn. Please contact us for a new one.', 'snelgraveren-product-designer'); ?></p>
    </div>
<?php else : ?>
    <div class="pf-proof__card">
        <h1 class="pf-proof__title"><?php echo esc_html($product ? $product->get_name() : __('Your design', 'snelgraveren-product-designer')); ?></h1>
        <?php if ($product) : ?>
            <p class="pf-proof__price"><?php echo wp_kses_post(wc_price(wc_get_price_to_display($product))); ?></p>
        <?php endif; ?>

        <?php foreach (($design['views'] ?? []) as $index => $view) : ?>
            <?php if (!empty($view['thumbnail'])) : ?>
                <img class="pf-proof__view" src="<?php echo esc_url($view['thumbnail']); ?>"
                     alt="<?php esc_attr_e('Proof preview', 'snelgraveren-product-designer'); ?>" />
                <p>
                    <a href="<?php echo esc_url(add_query_arg('sgpd_view', $index, ProofPage::url($token))); ?>" target="_blank" rel="noopener">
                        <?php esc_html_e('View at full size', 'snelgraveren-product-designer'); ?>
                    </a>
                </p>
            <?php endif; ?>
        <?php endforeach; ?>
    </div>
<?php endif; ?>

</div>
</body>
</html>
```

- [ ] **Step 5: Registreer de pagina**

In `includes/class-plugin.php`, waar de andere frontend-onderdelen worden geïnitialiseerd, voeg toe:

```php
        if (class_exists(\Snelgraveren\ProductDesigner\Proof\ProofPage::class)) {
            (new \Snelgraveren\ProductDesigner\Proof\ProofPage())->init();
        }
```

De `class_exists()` is verplicht: `includes/Proof/` wordt uit de gratis build gestript (Task 11).

- [ ] **Step 6: Draai de tests en bekijk de pagina**

```bash
docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter ProofPageTest"
# Maak handmatig een proefdruk om te bekijken:
docker compose exec -T wordpress wp eval '
$repo = new Snelgraveren\ProductDesigner\Database\DesignRepository();
$flow = new Snelgraveren\ProductDesigner\Proof\ProofWorkflow($repo);
echo Snelgraveren\ProductDesigner\Proof\ProofPage::url($flow->send(61)) . "\n";
' --path=/var/www/html --allow-root
```
Expected: tests PASS; de URL toont in een browser de thumbnail, naam en prijs. Een verzonnen token geeft "This proof is no longer valid" met HTTP 410, geen WordPress-404.

- [ ] **Step 7: Commit**

```bash
git add includes/Proof/class-proof-page.php templates/proof/proof-page.php includes/class-plugin.php tests/php/Proof/ProofPageTest.php
git commit -m "feat(proof): the customer-facing proof page

A query parameter, not a rewrite endpoint: add_rewrite_endpoint() needs a
flush_rewrite_rules(), and a flush at the wrong moment has already 404'd this
shop's category pages once.

Shows the STORED render rather than a fresh canvas, and is explicitly
no-cached for the same reason the designer page is: a publicly cached copy
would show one customer another's design."
```

---

### Task 6: "Toon op ware grootte" — de volledige render streamen

**Files:**
- Modify: `includes/Proof/class-proof-page.php` (`maybe_render()` en een nieuwe `stream_view()`)
- Test: `tests/php/Proof/ProofPageTest.php`

**Interfaces:**
- Consumes: `ProofPage::token_from_request()`, `DesignRepository::get_by_proof_token()`
- Produces: `ProofPage::decode_export_blob(string $blob): ?array` — `['mime' => string, 'bytes' => string]` of `null`

`export_svg` is per view een `data:image/png;base64,`-blob van ongeveer 580 KB (gemeten). Inline in de HTML maakt dat de pagina op een telefoon onbruikbaar, dus alleen op verzoek.

- [ ] **Step 1: Schrijf de falende test**

Toevoegen aan `tests/php/Proof/ProofPageTest.php`:

```php
    public function test_decode_export_blob_reads_a_png_data_url(): void {
        // 1x1 transparante PNG
        $b64  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        $out  = ProofPage::decode_export_blob('data:image/png;base64,' . $b64);

        $this->assertNotNull($out);
        $this->assertSame('image/png', $out['mime']);
        $this->assertSame("\x89PNG", substr($out['bytes'], 0, 4));
    }

    public function test_decode_export_blob_reads_svg_markup(): void {
        $out = ProofPage::decode_export_blob('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

        $this->assertNotNull($out);
        $this->assertSame('image/svg+xml', $out['mime']);
    }

    public function test_decode_export_blob_refuses_anything_else(): void {
        // Not a render: never stream it, whatever it claims to be.
        $this->assertNull(ProofPage::decode_export_blob(''));
        $this->assertNull(ProofPage::decode_export_blob('data:text/html;base64,PGh0bWw+'));
        $this->assertNull(ProofPage::decode_export_blob('data:image/png;base64,not-base64!!'));
        $this->assertNull(ProofPage::decode_export_blob('just some text'));
    }
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter ProofPageTest"`
Expected: FAIL — `Call to undefined method ... ::decode_export_blob()`

- [ ] **Step 3: Implementeer decoderen en streamen**

In `includes/Proof/class-proof-page.php`, voeg toe:

```php
    /**
     * Turn a stored export blob into bytes we may stream.
     *
     * Accepts exactly what RestDesigns::sanitize_export_blob() accepts on the
     * way in: a base64 PNG data URL, or SVG markup. Anything else is refused —
     * this method hands bytes to a browser with a content-type attached, so
     * "probably an image" is not good enough.
     *
     * @return array{mime: string, bytes: string}|null
     */
    public static function decode_export_blob(string $blob): ?array {
        $blob = trim($blob);
        if ($blob === '') {
            return null;
        }

        if (str_starts_with($blob, 'data:image/png;base64,')) {
            $bytes = base64_decode(substr($blob, strlen('data:image/png;base64,')), true);
            if ($bytes === false || substr($bytes, 0, 4) !== "\x89PNG") {
                return null;
            }
            return ['mime' => 'image/png', 'bytes' => $bytes];
        }

        if (str_starts_with($blob, '<')) {
            return ['mime' => 'image/svg+xml', 'bytes' => $blob];
        }

        return null;
    }

    /**
     * Stream one view's full-size render.
     *
     * Always inline, never an attachment: this is a proof to look at, not the
     * production file to hand out.
     */
    private function stream_view(array $design, int $index): void {
        $view = $design['views'][$index] ?? null;
        $out  = $view ? self::decode_export_blob((string) ($view['export_svg'] ?? '')) : null;

        if (!$out) {
            status_header(404);
            exit;
        }

        nocache_headers();
        header('Content-Type: ' . $out['mime']);
        header('Content-Length: ' . strlen($out['bytes']));
        header('Content-Disposition: inline');
        header('X-Content-Type-Options: nosniff');
        echo $out['bytes']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary image payload
        exit;
    }
```

En in `maybe_render()`, direct ná het ophalen van `$design` en vóór de `include`:

```php
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only view selector; the token is the credential
        if ($design && isset($_GET['sgpd_view'])) {
            $this->stream_view($design, (int) $_GET['sgpd_view']);
        }
```

- [ ] **Step 4: Draai de tests**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter ProofPageTest"`
Expected: PASS

- [ ] **Step 5: Controleer in de browser**

Open de proefdruk-URL uit Task 5 en klik "View at full size".
Expected: de volledige render opent in het tabblad (geen download), met content-type `image/png`.

- [ ] **Step 6: Commit**

```bash
git add includes/Proof/class-proof-page.php tests/php/Proof/ProofPageTest.php
git commit -m "feat(proof): stream a view's full-size render on request

export_svg is a ~580 KB base64 PNG per view; inlining it would make the page
useless on a phone. Served inline and never as an attachment: it is a proof to
look at, not the production file to hand out. Only the two shapes the save
path accepts are decoded — this hands bytes to a browser with a content-type,
so 'probably an image' is not good enough."
```

---

### Task 7: Goedkeuren → winkelwagen → kassa

**Files:**
- Modify: `includes/Proof/class-proof-page.php` (`maybe_render()` + `handle_approve()`)
- Modify: `templates/proof/proof-page.php` (knop en bevestigingstoestand)
- Test: `tests/php/Proof/ProofWorkflowTest.php` (de cart-koppeling apart getest in de browser)

**Interfaces:**
- Consumes: `ProofWorkflow::approve()`, `ProofSession::mark_approved()`
- Produces: `ProofPage::ACTION_APPROVE = 'approve'` (waarde van het `sgpd_action`-veld)

- [ ] **Step 1: Schrijf de falende test**

Toevoegen aan `tests/php/Proof/ProofWorkflowTest.php`:

```php
    public function test_approve_leaves_the_production_status_alone(): void {
        // Approving a proof is not ordering. The design stays a draft until an
        // order item carries its hash — the exports and the stats hang off
        // that, not off the proof.
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->flow->approve($token);

        $this->assertSame('draft', $this->repo->get($id)['status']);
    }
```

- [ ] **Step 2: Draai de test en controleer dat hij slaagt of faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter test_approve_leaves_the_production_status_alone"`
Expected: PASS — `update_proof()` heeft `status` niet in zijn whitelist (Task 1). Slaagt hij niet, dan is de whitelist gebroken en moet dát eerst gerepareerd.

- [ ] **Step 3: Verwerk de POST in de pagina**

In `includes/Proof/class-proof-page.php`, boven `maybe_render()`:

```php
    public const ACTION_APPROVE = 'approve';
```

En in `maybe_render()`, ná de `DONOTCACHEPAGE`-regels en vóór `status_header()`:

```php
        $design = (new DesignRepository())->get_by_proof_token($token);

        if ($design && ($_POST['sgpd_action'] ?? '') === self::ACTION_APPROVE) {
            $this->handle_approve($design, $token);
        }
```

(Vervang daarbij de bestaande `$design = ...`-regel; hij mag maar één keer voorkomen.)

Voeg de handler toe:

```php
    /**
     * Approve, then put the design in the cart and send the customer to
     * checkout.
     *
     * No nonce: the token IS the credential and the page is reachable without
     * a session, so a nonce would only break the link for anyone whose page
     * sat open. The action is not destructive — approving twice is a no-op —
     * and it is confined to the one design the token names.
     */
    private function handle_approve(array $design, string $token): void {
        try {
            $design = (new ProofWorkflow())->approve($token);
        } catch (\RuntimeException $e) {
            return; // Fall through to the page, which shows the current state.
        }

        ProofSession::mark_approved((string) $design['design_hash']);

        if (function_exists('WC') && WC()->cart) {
            WC()->cart->add_to_cart(
                (int) $design['product_id'],
                1,
                0,
                [],
                ['pf_design_hash' => $design['design_hash']]
            );
            wp_safe_redirect(wc_get_checkout_url());
            exit;
        }

        wp_safe_redirect(self::url($token));
        exit;
    }
```

- [ ] **Step 4: Zet de knop in het sjabloon**

In `templates/proof/proof-page.php`, binnen de `else`-tak ná de views-lus:

```php
        <?php if ($design['proof_status'] === 'approved') : ?>
            <p><strong><?php esc_html_e('You have already approved this design.', 'snelgraveren-product-designer'); ?></strong></p>
            <p><a href="<?php echo esc_url(wc_get_cart_url()); ?>"><?php esc_html_e('Go to your cart', 'snelgraveren-product-designer'); ?></a></p>
        <?php else : ?>
            <form method="post">
                <input type="hidden" name="sgpd_action" value="<?php echo esc_attr(ProofPage::ACTION_APPROVE); ?>" />
                <button type="submit"><?php esc_html_e('Approve and order', 'snelgraveren-product-designer'); ?></button>
            </form>
        <?php endif; ?>
```

- [ ] **Step 5: Loop de route in de browser**

1. Maak een proefdruk zoals in Task 5 en open de URL in een venster zonder sessie (privémodus).
2. Klik "Approve and order".
3. Controleer: je komt op de kassa; de winkelwagen bevat het product mét de ontwerp-thumbnail.
4. Controleer in de database: `proof_status = 'approved'` en `status = 'draft'`.

```bash
docker compose exec -T wordpress wp db query "SELECT id, status, proof_status FROM wp_pf_designs WHERE id=61" --path=/var/www/html --allow-root
```

Blijft de winkelwagen leeg, dan viel de hash weg in `add_cart_item_data` en werkt de sessiebrug uit Task 4 niet — dát is de fout, niet de knop.

- [ ] **Step 6: Commit**

```bash
git add includes/Proof/class-proof-page.php templates/proof/proof-page.php tests/php/Proof/ProofWorkflowTest.php
git commit -m "feat(proof): approving puts the design in the cart

Approving is not ordering: the design stays a draft until an order item
carries its hash, because the exports and the stats hang off that. No nonce on
the form — the token is the credential, the page is reachable without a
session, and a nonce would only break the link for anyone whose page sat open."
```

---

### Task 8: Wijziging aanvragen, met rate limit

**Files:**
- Modify: `includes/Proof/class-proof-page.php` (`ACTION_CHANGES`, `handle_changes()`, `rate_limited()`)
- Modify: `templates/proof/proof-page.php` (tekstvak)
- Test: `tests/php/Proof/ProofPageTest.php`

**Interfaces:**
- Consumes: `ProofWorkflow::request_changes()`
- Produces: `ProofPage::ACTION_CHANGES = 'changes'`, `ProofPage::RATE_LIMIT = 5`

- [ ] **Step 1: Schrijf de falende test**

Toevoegen aan `tests/php/Proof/ProofPageTest.php`:

```php
    public function test_rate_limit_blocks_the_sixth_request_within_an_hour(): void {
        $token = str_repeat('d', 32);
        delete_transient('sgpd_proof_note_' . md5($token));

        for ($i = 0; $i < ProofPage::RATE_LIMIT; $i++) {
            $this->assertFalse(ProofPage::rate_limited($token), "request {$i} should pass");
        }
        // The page needs no login, so the change-request form must not be
        // usable as a spam channel.
        $this->assertTrue(ProofPage::rate_limited($token));

        delete_transient('sgpd_proof_note_' . md5($token));
    }
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter test_rate_limit_blocks_the_sixth"`
Expected: FAIL — `Call to undefined method ... ::rate_limited()`

- [ ] **Step 3: Implementeer**

In `includes/Proof/class-proof-page.php`:

```php
    public const ACTION_CHANGES = 'changes';

    /** Change requests allowed per token per hour. */
    public const RATE_LIMIT = 5;

    /**
     * Same shape as UploadValidator's limiter. The proof page is reachable
     * without logging in, so this form must not be usable as a spam channel.
     * Counts, then reports — the caller decides what to show.
     */
    public static function rate_limited(string $token): bool {
        $key   = 'sgpd_proof_note_' . md5($token);
        $count = (int) get_transient($key);
        if ($count >= self::RATE_LIMIT) {
            return true;
        }
        set_transient($key, $count + 1, HOUR_IN_SECONDS);
        return false;
    }
```

En de handler:

```php
    private function handle_changes(array $design, string $token): string {
        if (self::rate_limited($token)) {
            return __('Too many requests. Please try again later.', 'snelgraveren-product-designer');
        }

        $note = isset($_POST['sgpd_note']) ? (string) wp_unslash($_POST['sgpd_note']) : '';
        if (trim($note) === '') {
            return __('Please describe what you would like changed.', 'snelgraveren-product-designer');
        }

        try {
            (new ProofWorkflow())->request_changes($token, $note);
        } catch (\RuntimeException $e) {
            return __('This proof can no longer be changed.', 'snelgraveren-product-designer');
        }

        return '';
    }
```

In `maybe_render()`, naast de approve-afhandeling:

```php
        $notice = '';
        if ($design && ($_POST['sgpd_action'] ?? '') === self::ACTION_CHANGES) {
            $notice = $this->handle_changes($design, $token);
            $design = (new DesignRepository())->get_by_proof_token($token);
        }
```

`$notice` is beschikbaar in het sjabloon.

- [ ] **Step 4: Zet het formulier in het sjabloon**

In `templates/proof/proof-page.php`, ná het approve-blok:

```php
        <?php if (!empty($notice)) : ?>
            <p style="color:#d63638;"><?php echo esc_html($notice); ?></p>
        <?php endif; ?>

        <?php if ($design['proof_status'] === 'changes_requested') : ?>
            <?php // NOTE: this state already has a branch from the approve task — MERGE into it,
                  // do not add a second one, or the customer's note renders twice. ?>
        <?php elseif ($design['proof_status'] !== 'approved') : ?>
            <form method="post">
                <input type="hidden" name="sgpd_action" value="<?php echo esc_attr(ProofPage::ACTION_CHANGES); ?>" />
                <label for="sgpd_note"><?php esc_html_e('Would you like something changed?', 'snelgraveren-product-designer'); ?></label><br />
                <textarea id="sgpd_note" name="sgpd_note" rows="4" maxlength="1000" style="width:100%;"></textarea><br />
                <button type="submit"><?php esc_html_e('Request a change', 'snelgraveren-product-designer'); ?></button>
            </form>
        <?php endif; ?>
```

- [ ] **Step 5: Draai de tests en probeer het in de browser**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter ProofPageTest"`
Expected: PASS. In de browser: een verzoek indienen toont de bevestiging met de eigen tekst; het zesde binnen een uur wordt geweigerd.

- [ ] **Step 6: Commit**

```bash
git add includes/Proof/class-proof-page.php templates/proof/proof-page.php tests/php/Proof/ProofPageTest.php
git commit -m "feat(proof): the customer can request a change

Rate-limited to five per hour per token, same shape as the upload limiter: the
page needs no login, so the form must not be usable as a spam channel."
```

---

### Task 9: De drie e-mails

**Files:**
- Create: `includes/Emails/class-proof-ready-email.php`
- Create: `includes/Emails/class-proof-changes-requested-email.php`
- Create: `includes/Emails/class-proof-approved-email.php`
- Create: `includes/Emails/class-proof-emails.php` (registratie + triggers)
- Create: `templates/emails/proof-ready.php`, `templates/emails/proof-changes-requested.php`, `templates/emails/proof-approved.php`
- Modify: `includes/Proof/class-proof-page.php` (triggers na approve en na wijzigingsverzoek)
- Modify: `includes/class-plugin.php` (registratie)

**Interfaces:**
- Consumes: `ProofWorkflow`, `ProofPage::url()`
- Produces: acties `sgpd_proof_ready_notification`, `sgpd_proof_changes_requested_notification`, `sgpd_proof_approved_notification`, elk aangeroepen als `do_action($hook, array $design, string $token)`

- [ ] **Step 1: Schrijf de registratieklasse**

Nieuw bestand `includes/Emails/class-proof-emails.php`:

```php
<?php
namespace Snelgraveren\ProductDesigner\Emails;

defined('ABSPATH') || exit;

/**
 * Registers the proof e-mails with WooCommerce.
 *
 * As WC_Email subclasses they appear under WooCommerce -> Settings -> E-mails,
 * inherit the shop's mail styling, and the merchant can rewrite the wording
 * without touching code. Registration is skipped entirely when WooCommerce is
 * absent, so the plugin still boots.
 */
class ProofEmails {

    public function init(): void {
        add_filter('woocommerce_email_classes', [$this, 'register']);
    }

    public function register(array $emails): array {
        if (!class_exists('WC_Email')) {
            return $emails;
        }

        require_once __DIR__ . '/class-proof-ready-email.php';
        require_once __DIR__ . '/class-proof-changes-requested-email.php';
        require_once __DIR__ . '/class-proof-approved-email.php';

        $emails['SGPD_Proof_Ready']             = new ProofReadyEmail();
        $emails['SGPD_Proof_Changes_Requested'] = new ProofChangesRequestedEmail();
        $emails['SGPD_Proof_Approved']          = new ProofApprovedEmail();

        return $emails;
    }
}
```

- [ ] **Step 2: Schrijf de klantmail**

Nieuw bestand `includes/Emails/class-proof-ready-email.php`:

```php
<?php
namespace Snelgraveren\ProductDesigner\Emails;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Proof\ProofPage;

/** "Your proof is ready" — to the customer. */
class ProofReadyEmail extends \WC_Email {

    public function __construct() {
        $this->id             = 'sgpd_proof_ready';
        $this->title          = __('Proof ready', 'snelgraveren-product-designer');
        $this->description    = __('Sent to the customer when you send them a proof to approve.', 'snelgraveren-product-designer');
        $this->template_html  = 'emails/proof-ready.php';
        $this->template_base  = SGPD_PLUGIN_DIR . 'templates/';
        $this->placeholders   = ['{site_title}' => $this->get_blogname()];

        add_action('sgpd_proof_ready_notification', [$this, 'trigger'], 10, 2);

        parent::__construct();
    }

    public function get_default_subject(): string {
        return __('Your proof is ready to approve', 'snelgraveren-product-designer');
    }

    public function get_default_heading(): string {
        return __('Your proof is ready', 'snelgraveren-product-designer');
    }

    public function trigger(array $design, string $token): void {
        $this->setup_locale();

        $customer = (int) $design['customer_id'] > 0 ? get_user_by('id', (int) $design['customer_id']) : null;
        $this->recipient = $customer ? $customer->user_email : ($design['proof_email'] ?? '');

        if ($this->is_enabled() && $this->get_recipient()) {
            $this->object = ['design' => $design, 'url' => ProofPage::url($token)];
            $this->send($this->get_recipient(), $this->get_subject(), $this->get_content(), $this->get_headers(), $this->get_attachments());
        }

        $this->restore_locale();
    }

    public function get_content_html(): string {
        return wc_get_template_html($this->template_html, [
            'email_heading' => $this->get_heading(),
            'design'        => $this->object['design'],
            'proof_url'     => $this->object['url'],
            'sent_to_admin' => false,
            'plain_text'    => false,
            'email'         => $this,
        ], '', $this->template_base);
    }
}
```

- [ ] **Step 3: Schrijf de twee winkeliersmails**

Nieuw bestand `includes/Emails/class-proof-changes-requested-email.php`:

```php
<?php
namespace Snelgraveren\ProductDesigner\Emails;

defined('ABSPATH') || exit;

/** "A customer requested a change" — to the shop. */
class ProofChangesRequestedEmail extends \WC_Email {

    public function __construct() {
        $this->id            = 'sgpd_proof_changes_requested';
        $this->title         = __('Proof: change requested', 'snelgraveren-product-designer');
        $this->description   = __('Sent to you when a customer asks for a change to their proof.', 'snelgraveren-product-designer');
        $this->template_html = 'emails/proof-changes-requested.php';
        $this->template_base = SGPD_PLUGIN_DIR . 'templates/';
        $this->placeholders  = ['{site_title}' => $this->get_blogname()];

        add_action('sgpd_proof_changes_requested_notification', [$this, 'trigger'], 10, 2);

        parent::__construct();

        $this->recipient = $this->get_option('recipient', get_option('admin_email'));
    }

    public function get_default_subject(): string {
        return __('A customer requested a change to a proof', 'snelgraveren-product-designer');
    }

    public function get_default_heading(): string {
        return __('Change requested', 'snelgraveren-product-designer');
    }

    public function init_form_fields(): void {
        parent::init_form_fields();
        $this->form_fields = array_merge([
            'recipient' => [
                'title'       => __('Recipient(s)', 'snelgraveren-product-designer'),
                'type'        => 'text',
                /* translators: %s: the site's admin e-mail address */
                'description' => sprintf(__('Defaults to %s.', 'snelgraveren-product-designer'), '<code>' . esc_attr(get_option('admin_email')) . '</code>'),
                'placeholder' => '',
                'default'     => '',
            ],
        ], $this->form_fields);
    }

    public function trigger(array $design, string $token): void {
        $this->setup_locale();
        $this->object = ['design' => $design, 'token' => $token];

        if ($this->is_enabled() && $this->get_recipient()) {
            $this->send($this->get_recipient(), $this->get_subject(), $this->get_content(), $this->get_headers(), $this->get_attachments());
        }

        $this->restore_locale();
    }

    public function get_content_html(): string {
        return wc_get_template_html($this->template_html, [
            'email_heading' => $this->get_heading(),
            'design'        => $this->object['design'],
            'admin_url'     => admin_url('admin.php?page=sgpd-designs'),
            'sent_to_admin' => true,
            'plain_text'    => false,
            'email'         => $this,
        ], '', $this->template_base);
    }
}
```

Nieuw bestand `includes/Emails/class-proof-approved-email.php` — identiek van vorm, met de vier waarden die verschillen:

```php
<?php
namespace Snelgraveren\ProductDesigner\Emails;

defined('ABSPATH') || exit;

/** "A customer approved their proof" — to the shop. */
class ProofApprovedEmail extends \WC_Email {

    public function __construct() {
        $this->id            = 'sgpd_proof_approved';
        $this->title         = __('Proof: approved', 'snelgraveren-product-designer');
        $this->description   = __('Sent to you when a customer approves their proof.', 'snelgraveren-product-designer');
        $this->template_html = 'emails/proof-approved.php';
        $this->template_base = SGPD_PLUGIN_DIR . 'templates/';
        $this->placeholders  = ['{site_title}' => $this->get_blogname()];

        add_action('sgpd_proof_approved_notification', [$this, 'trigger'], 10, 2);

        parent::__construct();

        $this->recipient = $this->get_option('recipient', get_option('admin_email'));
    }

    public function get_default_subject(): string {
        return __('A customer approved their proof', 'snelgraveren-product-designer');
    }

    public function get_default_heading(): string {
        return __('Proof approved', 'snelgraveren-product-designer');
    }

    public function init_form_fields(): void {
        parent::init_form_fields();
        $this->form_fields = array_merge([
            'recipient' => [
                'title'       => __('Recipient(s)', 'snelgraveren-product-designer'),
                'type'        => 'text',
                /* translators: %s: the site's admin e-mail address */
                'description' => sprintf(__('Defaults to %s.', 'snelgraveren-product-designer'), '<code>' . esc_attr(get_option('admin_email')) . '</code>'),
                'placeholder' => '',
                'default'     => '',
            ],
        ], $this->form_fields);
    }

    public function trigger(array $design, string $token): void {
        $this->setup_locale();
        $this->object = ['design' => $design, 'token' => $token];

        if ($this->is_enabled() && $this->get_recipient()) {
            $this->send($this->get_recipient(), $this->get_subject(), $this->get_content(), $this->get_headers(), $this->get_attachments());
        }

        $this->restore_locale();
    }

    public function get_content_html(): string {
        return wc_get_template_html($this->template_html, [
            'email_heading' => $this->get_heading(),
            'design'        => $this->object['design'],
            'admin_url'     => admin_url('admin.php?page=sgpd-designs'),
            'sent_to_admin' => true,
            'plain_text'    => false,
            'email'         => $this,
        ], '', $this->template_base);
    }
}
```

- [ ] **Step 4: Schrijf de drie sjablonen**

`templates/emails/proof-ready.php`:

```php
<?php
defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);

$product = wc_get_product((int) $design['product_id']);
?>
<p><?php esc_html_e('We have prepared your design. Please take a look and let us know.', 'snelgraveren-product-designer'); ?></p>

<?php if ($product) : ?>
    <p><strong><?php echo esc_html($product->get_name()); ?></strong><br />
    <?php echo wp_kses_post(wc_price(wc_get_price_to_display($product))); ?></p>
<?php endif; ?>

<?php foreach (($design['views'] ?? []) as $view) : ?>
    <?php if (!empty($view['thumbnail'])) : ?>
        <p><img src="<?php echo esc_url($view['thumbnail']); ?>" alt="" style="max-width:100%;height:auto;" /></p>
    <?php endif; ?>
<?php endforeach; ?>

<p><a href="<?php echo esc_url($proof_url); ?>" style="display:inline-block;padding:12px 20px;background:#2271b1;color:#fff;text-decoration:none;border-radius:4px;">
    <?php esc_html_e('View and approve', 'snelgraveren-product-designer'); ?>
</a></p>

<?php
do_action('woocommerce_email_footer', $email);
```

De twee winkeliersmails zijn korter: onderwerp, de link naar het Designs-scherm (`admin_url('admin.php?page=sgpd-designs')`), en bij "changes requested" het verzoek zelf via `esc_html($design['proof_note'])`.

- [ ] **Step 5: Vuur de triggers af**

In `includes/Proof/class-proof-page.php`, in `handle_approve()` ná `ProofSession::mark_approved(...)`:

```php
        do_action('sgpd_proof_approved_notification', $design, $token);
```

In `handle_changes()`, ná een geslaagde `request_changes()`:

```php
        do_action('sgpd_proof_changes_requested_notification', (new DesignRepository())->get_by_proof_token($token), $token);
```

Het versturen zelf (`sgpd_proof_ready_notification`) hangt aan de knop in Task 10.

- [ ] **Step 6: Registreer**

In `includes/class-plugin.php`, naast de ProofPage-registratie:

```php
        if (class_exists(\Snelgraveren\ProductDesigner\Emails\ProofEmails::class)) {
            (new \Snelgraveren\ProductDesigner\Emails\ProofEmails())->init();
        }
```

- [ ] **Step 7: Controleer**

```bash
docker compose exec -T wordpress php -l /var/www/html/wp-content/plugins/productforge/includes/Emails/class-proof-emails.php
```
Open WooCommerce → Instellingen → E-mails: de drie mails staan in de lijst en zijn te openen.

- [ ] **Step 8: Commit**

```bash
git add includes/Emails/ templates/emails/proof-*.php includes/Proof/class-proof-page.php includes/class-plugin.php
git commit -m "feat(proof): proof e-mails as WC_Email classes

Registered through woocommerce_email_classes so they appear under WooCommerce
-> Settings -> E-mails: the shop's own styling, and the merchant can rewrite
the wording without a code change. Skipped entirely when WooCommerce is absent."
```

---

### Task 10: Het Designs-scherm

**Files:**
- Modify: `includes/Admin/class-designs-page.php` (kolom, knoppen, filter, handler)
- Test: `tests/php/Admin/DesignsPageTest.php`

**Interfaces:**
- Consumes: `ProofWorkflow::send()`, `ProofWorkflow::withdraw()`, `ProofPage::url()`
- Produces: `admin_post_sgpd_proof_action`, `DesignsPage::proof_label(string $state): string`

- [ ] **Step 1: Schrijf de falende test**

Toevoegen aan `tests/php/Admin/DesignsPageTest.php`:

```php
    public function test_proof_label_is_human_readable_for_every_state(): void {
        foreach (\Snelgraveren\ProductDesigner\Proof\ProofWorkflow::STATES as $state) {
            $label = DesignsPage::proof_label($state);
            $this->assertNotSame('', $label, "state {$state} has no label");
            $this->assertNotSame($state, $label, "state {$state} shows its raw enum value");
        }
    }

    public function test_proof_label_of_an_unknown_state_is_empty(): void {
        $this->assertSame('', DesignsPage::proof_label('nonsense'));
    }
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit --filter DesignsPageTest"`
Expected: FAIL — `Call to undefined method ... ::proof_label()`

- [ ] **Step 3: Implementeer label, handler en kolom**

In `includes/Admin/class-designs-page.php`:

```php
    public static function proof_label(string $state): string {
        switch ($state) {
            case 'none':              return __('Not sent', 'snelgraveren-product-designer');
            case 'sent':              return __('Waiting for customer', 'snelgraveren-product-designer');
            case 'changes_requested': return __('Change requested', 'snelgraveren-product-designer');
            case 'approved':          return __('Approved', 'snelgraveren-product-designer');
            default:                  return '';
        }
    }
```

In `init()`:

```php
        add_action('admin_post_sgpd_proof_action', [$this, 'handle_proof_action']);
```

De handler, in dezelfde vorm als `handle_assign()` (capability, `check_admin_referer`, redirect met `sgpd_msg` + `sgpd_row`):

```php
    public function handle_proof_action(): void {
        if (!current_user_can('edit_sgpd_templates')) {
            wp_die(esc_html__('You do not have permission to do that.', 'snelgraveren-product-designer'));
        }
        $id = isset($_POST['design_id']) ? (int) $_POST['design_id'] : 0;
        check_admin_referer('sgpd_proof_action_' . $id);

        $back = admin_url('admin.php?page=' . self::PAGE_SLUG);
        $flow = new \Snelgraveren\ProductDesigner\Proof\ProofWorkflow();

        try {
            if (isset($_POST['withdraw'])) {
                $flow->withdraw($id);
                $msg = 'proof_withdrawn';
            } else {
                $email = isset($_POST['proof_email']) ? sanitize_email(wp_unslash($_POST['proof_email'])) : '';
                $token = $flow->send($id);
                if ($email !== '') {
                    (new DesignRepository())->update_proof($id, ['proof_email' => $email]);
                }
                do_action('sgpd_proof_ready_notification', (new DesignRepository())->get($id), $token);
                $msg = 'proof_sent';
            }
        } catch (\RuntimeException $e) {
            $msg = 'proof_failed';
        }

        wp_safe_redirect(add_query_arg(['sgpd_msg' => $msg, 'sgpd_row' => $id], $back));
        exit;
    }
```

Vul `row_message()` aan met drie gevallen:

```php
            case 'proof_sent':
                return __('Proof sent. The customer can view and approve it from the link in their e-mail.', 'snelgraveren-product-designer');
            case 'proof_withdrawn':
                return __('Proof withdrawn. The link no longer works.', 'snelgraveren-product-designer');
            case 'proof_failed':
                return __('Could not send this proof.', 'snelgraveren-product-designer');
```

Voeg in `render()` de kolomkop toe, ná de kop "Assign to customer":

```php
                        <th style="width:22%;"><?php esc_html_e('Proof', 'snelgraveren-product-designer'); ?></th>
```

En als laatste cel in de rijlus:

```php
                        <td>
                        <?php if (\Snelgraveren\ProductDesigner\Plugin::has_feature('proofs')
                            && class_exists(\Snelgraveren\ProductDesigner\Proof\ProofWorkflow::class)) : ?>
                            <?php $proof_state = (string) ($design['proof_status'] ?? 'none'); ?>
                            <strong><?php echo esc_html(self::proof_label($proof_state)); ?></strong>
                            <?php if (!empty($design['proof_sent_at'])) : ?>
                                <br /><span class="description"><?php echo esc_html(mysql2date(get_option('date_format') . ' H:i', $design['proof_sent_at'])); ?></span>
                            <?php endif; ?>

                            <?php if ($proof_state === 'changes_requested' && !empty($design['proof_note'])) : ?>
                                <p style="margin:6px 0;padding:6px;background:#fcf9e8;border-left:3px solid #dba617;">
                                    <?php echo esc_html((string) $design['proof_note']); ?>
                                </p>
                            <?php endif; ?>

                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top:6px;">
                                <input type="hidden" name="action" value="sgpd_proof_action" />
                                <input type="hidden" name="design_id" value="<?php echo esc_attr((string) $design_id); ?>" />
                                <?php wp_nonce_field('sgpd_proof_action_' . $design_id); ?>
                                <input type="email" name="proof_email" style="width:100%;margin-bottom:4px;"
                                       value="<?php echo esc_attr((string) ($design['proof_email'] ?? '')); ?>"
                                       placeholder="<?php esc_attr_e('E-mail address for the proof', 'snelgraveren-product-designer'); ?>" />
                                <?php submit_button(
                                    $proof_state === 'none'
                                        ? __('Send proof', 'snelgraveren-product-designer')
                                        : __('Send again', 'snelgraveren-product-designer'),
                                    'secondary', '', false
                                ); ?>
                                <?php if ($proof_state !== 'none') : ?>
                                    <button type="submit" name="withdraw" value="1" class="button-link button-link-delete">
                                        <?php esc_html_e('Withdraw', 'snelgraveren-product-designer'); ?>
                                    </button>
                                <?php endif; ?>
                            </form>
                        <?php else : ?>
                            <span class="description"><?php esc_html_e('Pro feature', 'snelgraveren-product-designer'); ?></span>
                        <?php endif; ?>
                        </td>
```

Verhoog de `colspan` van de "No designs found"-rij van 6 naar 7.

Voeg naast het bestaande statusfilter een tweede select toe, in dezelfde vorm:

```php
                <select name="sgpd_proof">
                    <?php
                    $proof_filters = [
                        ''                  => __('Any proof state', 'snelgraveren-product-designer'),
                        'none'              => __('Not sent', 'snelgraveren-product-designer'),
                        'sent'              => __('Waiting for customer', 'snelgraveren-product-designer'),
                        'changes_requested' => __('Change requested', 'snelgraveren-product-designer'),
                        'approved'          => __('Approved', 'snelgraveren-product-designer'),
                    ];
                    foreach ($proof_filters as $key => $label) : ?>
                        <option value="<?php echo esc_attr($key); ?>" <?php selected($proof, $key); ?>><?php echo esc_html($label); ?></option>
                    <?php endforeach; ?>
                </select>
```

Lees hem bovenin `render()` en geef hem door als filter:

```php
        $proof = sanitize_key($_GET['sgpd_proof'] ?? '');
        if (in_array($proof, \Snelgraveren\ProductDesigner\Proof\ProofWorkflow::STATES, true)) {
            $filters['proof_status'] = $proof;
        }
```

Breid daarvoor `DesignRepository::admin_filter_sql()` uit met:

```php
        if (!empty($filters['proof_status'])) {
            $where[]  = 'proof_status = %s';
            $params[] = (string) $filters['proof_status'];
        }
```

- [ ] **Step 4: Draai de tests**

Run: `docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit"`
Expected: PASS

- [ ] **Step 5: Controleer in de browser**

Open Product Designer → Designs: de kolom Proof staat er, "Send proof" werkt, de melding komt op de rij (niet als adminmelding — Admin Site Enhancements veegt die weg), en "Withdraw" maakt de link dood.

- [ ] **Step 6: Commit**

```bash
git add includes/Admin/class-designs-page.php tests/php/Admin/DesignsPageTest.php
git commit -m "feat(admin): send, resend and withdraw a proof from the Designs screen

Result reporting stays on the row for the same reason assigning does: this
shop's notice-collector plugin sweeps admin notices into a hidden drawer."
```

---

### Task 11: Pro-gating en de gratis build

**Files:**
- Modify: `includes/class-plugin.php` (`has_feature()`, sleutel `proofs`)
- Modify: `snelgraveren-product-designer.php:16` (`@fs_premium_only`)

**Interfaces:**
- Consumes: alle voorgaande taken
- Produces: `Plugin::has_feature('proofs')`

- [ ] **Step 1: Voeg de feature-sleutel toe**

In `includes/class-plugin.php`, in `$premium_features`, na `'auto_export',`:

```php
            'proofs',
```

- [ ] **Step 2: Strip de servercode uit de gratis build**

In `snelgraveren-product-designer.php`, regel 16, vul de `@fs_premium_only`-lijst aan met:

```
, /includes/Proof/, /includes/Emails/, /templates/proof/, /templates/emails/proof-ready.php, /templates/emails/proof-changes-requested.php, /templates/emails/proof-approved.php
```

- [ ] **Step 3: Controleer dat de plugin zonder die mappen boot**

```bash
mkdir -p /tmp/proof-strip && mv includes/Proof /tmp/proof-strip/ && mv includes/Emails /tmp/proof-strip/
docker compose exec -T wordpress wp eval 'echo "boots\n";' --path=/var/www/html --allow-root
docker compose exec -T wordpress wp eval 'echo Snelgraveren\ProductDesigner\Plugin::has_feature("proofs") ? "pro\n" : "free\n";' --path=/var/www/html --allow-root
mv /tmp/proof-strip/Proof includes/ && mv /tmp/proof-strip/Emails includes/
```
Expected: "boots" zonder fatale fout, en het Designs-scherm laadt zonder de proefdrukkolom. Faalt dit, dan mist ergens een `class_exists()`-guard (Task 4 stap 4, Task 5 stap 5, Task 9 stap 6, Task 10 stap 3).

- [ ] **Step 4: Draai de volledige suites**

```bash
docker compose exec -T wordpress bash -c "cd /var/www/html/wp-content/plugins/productforge && phpunit"
npm test
```
Expected: PHP volledig groen; JS onveranderd (de twee bestaande `matchMedia`-suites falen nog steeds — dat is geen regressie).

- [ ] **Step 5: Commit**

```bash
git add includes/class-plugin.php snelgraveren-product-designer.php
git commit -m "feat(proof): gate proofs as a Pro feature

Server code stripped from the free build via @fs_premium_only; every caller
outside includes/Proof and includes/Emails reaches them through class_exists()
so the free build still boots."
```

---

### Task 12: Documentatie, versie en pakket

**Files:**
- Modify: `CLAUDE.md` (sectie "Handing a design to a customer", tabel Admin Pages, Database Tables)
- Modify: `HANDOFF.md`
- Modify: `snelgraveren-product-designer.php` (header + `SGPD_VERSION`)
- Modify: `readme.txt` (Stable tag + changelog)

- [ ] **Step 1: Vul CLAUDE.md aan**

Onder "Handing a design to a customer" een subsectie over de proefdrukstroom: de toestandsmachine in `Proof\ProofWorkflow`, dat het token los staat van `design_hash` en waarom, dat `Frontend::owns_design()` één clausule heeft die `RestDesigns` níét heeft, dat de pagina een query-parameter is en geen rewrite-endpoint, en dat `find_stale_guest_drafts()` proefdrukken overslaat.

Vul de tabel Database Tables aan bij `wp_pf_designs`: "+ proof state (`proof_status`, `proof_token`, `proof_sent_at`, `proof_note`, `proof_email`)".

- [ ] **Step 2: Werk HANDOFF.md bij**

Vervang de sectie "Handing a design to a customer (new in 1.9.0)" door de nieuwe stand: de proefdrukstroom is er, wat hij wel en niet doet, en het openstaande punt uit de spec (een klant met account kan na goedkeuring alsnog via `?pf_design=HASH` wijzigen).

- [ ] **Step 3: Bump de versie**

`snelgraveren-product-designer.php`: header `Version:` en `SGPD_VERSION` naar `1.10.0`.
`readme.txt`: `Stable tag: 1.10.0` plus een changelog-item in de stijl van de bestaande regels — één zin per zichtbare verandering, geen jargon.

- [ ] **Step 4: Bouw en controleer het pakket**

```bash
bash bin/package.sh
```
Controleer daarna IN de zip (niet op naam of datum) dat `includes/Proof/class-proof-workflow.php` aanwezig is en dat het versienummer in het hoofdbestand, `SGPD_VERSION` en de Stable tag alle drie `1.10.0` zijn.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md HANDOFF.md snelgraveren-product-designer.php readme.txt
git commit -m "chore(release): 1.10.0 — proof and approval flow"
```

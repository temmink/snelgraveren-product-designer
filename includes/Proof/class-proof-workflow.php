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
     *
     * proof_note is deliberately left untouched here: the note survives a
     * resend on purpose, so the merchant can still see what was asked while
     * amending the design. The admin screen only displays it in the
     * changes_requested state, so it cannot show as current feedback.
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
        $design = $this->repo->get($design_id);
        if (!$design) {
            throw new \RuntimeException('Design not found.', 404);
        }
        $this->assert($design['proof_status'], 'withdraw');

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

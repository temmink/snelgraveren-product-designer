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

    public function test_approve_leaves_the_production_status_alone(): void {
        // Approving a proof is not ordering. The design stays a draft until an
        // order item carries its hash — the exports and the stats hang off
        // that, not off the proof.
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->flow->approve($token);

        $this->assertSame('draft', $this->repo->get($id)['status']);
    }

    public function test_request_changes_stores_the_note(): void {
        $id     = $this->make_design();
        $token  = $this->flow->send($id);
        $design = $this->flow->request_changes($token, '  De naam mag groter  ');

        $this->assertSame('changes_requested', $design['proof_status']);
        $this->assertSame('De naam mag groter', $design['proof_note']);
    }

    public function test_note_longer_than_max_is_truncated(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $long  = str_repeat('x', ProofWorkflow::MAX_NOTE + 50);

        $design = $this->flow->request_changes($token, $long);

        $this->assertSame(ProofWorkflow::MAX_NOTE, strlen($design['proof_note']));
    }

    public function test_request_changes_is_refused_once_approved(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->flow->approve($token);

        $this->expectException(\RuntimeException::class);
        $this->flow->request_changes($token, 'Toch anders');
    }

    public function test_approve_is_refused_from_none(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        // Force the design back to 'none' while keeping the issued token, to
        // exercise the guard directly through approve() itself: this state is
        // otherwise unreachable with a live token, since withdraw() wipes the
        // token too.
        $this->repo->update_proof($id, ['proof_status' => 'none']);

        $this->expectException(\RuntimeException::class);
        $this->flow->approve($token);
    }

    public function test_request_changes_is_refused_from_none(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->repo->update_proof($id, ['proof_status' => 'none']);

        $this->expectException(\RuntimeException::class);
        $this->flow->request_changes($token, 'Toch anders');
    }

    public function test_approve_is_refused_from_changes_requested(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->flow->request_changes($token, 'Groter graag');

        $this->expectException(\RuntimeException::class);
        $this->flow->approve($token);
    }

    public function test_request_changes_is_refused_from_changes_requested(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->flow->request_changes($token, 'Groter graag');

        $this->expectException(\RuntimeException::class);
        $this->flow->request_changes($token, 'Nog een keer');
    }

    public function test_withdraw_kills_the_link(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);

        $this->assertTrue($this->flow->withdraw($id));
        $this->assertNull($this->repo->get_by_proof_token($token));
        $this->assertSame('none', $this->repo->get($id)['proof_status']);
    }

    public function test_withdraw_from_none_is_a_noop_success(): void {
        $id = $this->make_design();

        $this->assertTrue($this->flow->withdraw($id));
        $this->assertSame('none', $this->repo->get($id)['proof_status']);
    }

    public function test_withdraw_from_approved(): void {
        $id    = $this->make_design();
        $token = $this->flow->send($id);
        $this->flow->approve($token);

        $this->assertTrue($this->flow->withdraw($id));
        $this->assertNull($this->repo->get_by_proof_token($token));
        $this->assertSame('none', $this->repo->get($id)['proof_status']);
    }

    public function test_withdraw_on_nonexistent_design_throws(): void {
        $this->expectException(\RuntimeException::class);
        $this->flow->withdraw(999999999);
    }

    public function test_an_unknown_token_is_refused(): void {
        $this->expectException(\RuntimeException::class);
        $this->flow->approve(str_repeat('f', 32));
    }

    public function test_request_changes_with_unknown_token_is_refused(): void {
        $this->expectException(\RuntimeException::class);
        $this->flow->request_changes(str_repeat('f', 32), 'note');
    }

    public function test_allows_matches_the_transition_table(): void {
        $this->assertTrue(ProofWorkflow::allows('none', 'send'));
        $this->assertTrue(ProofWorkflow::allows('changes_requested', 'send'));
        $this->assertTrue(ProofWorkflow::allows('sent', 'send'));
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

<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\DesignRepository;
use Snelgraveren\ProductDesigner\Proof\ProofPage;
use Snelgraveren\ProductDesigner\Proof\ProofWorkflow;

class ProofPageTest extends TestCase {

    private array $created_design_ids  = [];
    private array $created_product_ids = [];

    protected function tearDown(): void {
        unset($_GET['sgpd_proof']);

        if (function_exists('WC') && WC()->cart) {
            WC()->cart->empty_cart();
        }

        $repo = new DesignRepository();
        foreach ($this->created_design_ids as $id) {
            $repo->delete($id);
        }
        $this->created_design_ids = [];

        foreach ($this->created_product_ids as $id) {
            wp_delete_post($id, true);
        }
        $this->created_product_ids = [];
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
        // Not a render: never stream it, whatever it claims to be. This also
        // covers a view whose export_svg is empty — stream_view() decodes ''
        // the same way and 404s on the null.
        $this->assertNull(ProofPage::decode_export_blob(''));
        $this->assertNull(ProofPage::decode_export_blob('data:text/html;base64,PGh0bWw+'));
        $this->assertNull(ProofPage::decode_export_blob('data:image/png;base64,not-base64!!'));
        $this->assertNull(ProofPage::decode_export_blob('just some text'));
    }

    /**
     * Real sanitised SVG output (enshrined/svg-sanitize) starts with an
     * `<?xml version…?>` prologue, not `<svg`. decode_export_blob() must
     * still recognise and accept it — and since it now re-sanitises on the
     * way out (with remote references stripped), this also proves that
     * round trip actually works rather than just the `str_starts_with('<')`
     * gate.
     */
    public function test_decode_export_blob_accepts_the_xml_prologue_the_sanitizer_emits(): void {
        $svg = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><rect width=\"10\" height=\"10\"/></svg>";
        $out = ProofPage::decode_export_blob($svg);

        $this->assertNotNull($out);
        $this->assertSame('image/svg+xml', $out['mime']);
        $this->assertStringStartsWith('<?xml', $out['bytes']);
    }

    /**
     * maybe_render() calls exit() on both the 200 and 410 paths, so its HTTP
     * behaviour can't be exercised directly here without killing the PHPUnit
     * process. What we CAN prove without exiting: a bogus token never reaches
     * a real design row, so status_header(410) is the only branch maybe_render()
     * can take for it — the 200/stream_view branches are unreachable for such
     * a token.
     */
    public function test_a_bogus_token_yields_no_design_so_only_410_is_reachable(): void {
        $repo = new DesignRepository();
        $this->assertNull($repo->get_by_proof_token(str_repeat('a', 32)));
    }

    /**
     * add_design_to_cart() is private. handle_approve(), which calls it, exits
     * on every reachable path (redirect to checkout or back to the proof
     * page), so it can't be exercised directly here without killing the
     * PHPUnit process — reflection on the cart-add step itself is the only
     * way to catch a replay bug, same pattern as
     * DesignEndpointTest::owns_design() and
     * PriceCalculatorTest::classify_object().
     */
    private function invoke_add_design_to_cart(ProofPage $page, array $design): bool {
        $method = new \ReflectionMethod(ProofPage::class, 'add_design_to_cart');
        $method->setAccessible(true);
        return $method->invoke($page, $design);
    }

    /**
     * A replayed approve POST — double-click, F5 "resend", the back button,
     * or the old open tab the no-nonce design explicitly protects — must not
     * add the same design to the cart twice. Before the fix, WooCommerce
     * resolved the second add_to_cart() to the same cart id (same product +
     * same pf_design_hash) and bumped the quantity instead of refusing.
     */
    public function test_a_replayed_approve_does_not_double_the_cart_quantity(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce cart not available in this context.');
        }

        $product = new \WC_Product_Simple();
        $product->set_name('PF Proof Test Product');
        $product->set_regular_price('10');
        $product->set_status('publish');
        $product_id = $product->save();
        $this->created_product_ids[] = $product_id;

        $repo = new DesignRepository();
        $id   = $repo->create([
            'template_id' => 1, 'product_id' => $product_id, 'customer_id' => 0,
            'session_id'  => 'proof-page-test-' . uniqid(),
        ]);
        $this->created_design_ids[] = $id;
        $design = $repo->get($id);

        WC()->cart->empty_cart();
        $page = new ProofPage();

        $this->assertTrue($this->invoke_add_design_to_cart($page, $design));
        $this->assertTrue($this->invoke_add_design_to_cart($page, $design));

        $cart_item = null;
        foreach (WC()->cart->get_cart() as $item) {
            if (($item['pf_design_hash'] ?? '') === $design['design_hash']) {
                $cart_item = $item;
            }
        }

        $this->assertNotNull($cart_item, 'the design must be in the cart');
        $this->assertSame(1, $cart_item['quantity'], 'a replayed approve must not bump the quantity');
    }

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

    /**
     * A product that cannot actually be added (trashed, unpublished, or
     * vetoed by another plugin) must be reported as a failure, not silently
     * treated as success — handle_approve() relies on this return value to
     * decide whether it is safe to send the customer to checkout.
     */
    public function test_add_design_to_cart_reports_failure_instead_of_pretending_it_worked(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce cart not available in this context.');
        }

        $repo = new DesignRepository();
        $id   = $repo->create([
            'template_id' => 1, 'product_id' => 999999999, 'customer_id' => 0,
            'session_id'  => 'proof-page-test-' . uniqid(),
        ]);
        $this->created_design_ids[] = $id;
        $design = $repo->get($id);

        WC()->cart->empty_cart();
        $page = new ProofPage();

        $this->assertFalse(
            $this->invoke_add_design_to_cart($page, $design),
            'a product that cannot be added must be reported, not silently accepted'
        );
        $this->assertSame(0, WC()->cart->get_cart_contents_count());
    }

    private function invoke_handle_changes(ProofPage $page, array $design, string $token): string {
        $method = new \ReflectionMethod(ProofPage::class, 'handle_changes');
        $method->setAccessible(true);
        return $method->invoke($page, $design, $token);
    }

    private function make_sent_design(): array {
        $repo  = new DesignRepository();
        $id    = $repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'proof-page-test-' . uniqid(),
        ]);
        $this->created_design_ids[] = $id;

        $token = (new ProofWorkflow($repo))->send($id);
        delete_transient('sgpd_proof_note_' . md5($token));

        return [$repo, $id, $token];
    }

    /**
     * The message alone is not enough: a handler that returns the right
     * string while still writing to the database would pass a test that
     * only checked the notice. Assert both halves for every blank variant.
     */
    public function test_handle_changes_refuses_an_empty_or_whitespace_note(): void {
        [$repo, $id, $token] = $this->make_sent_design();
        $page = new ProofPage();

        foreach (['', '   ', "\n\t "] as $blank) {
            $_POST['sgpd_note'] = $blank;
            $design = $repo->get($id);

            $notice = $this->invoke_handle_changes($page, $design, $token);

            $this->assertSame(
                'Please describe what you would like changed.',
                $notice,
                'blank note must be refused: ' . var_export($blank, true)
            );
            $this->assertSame(
                'sent',
                $repo->get($id)['proof_status'],
                'a refused note must not change the proof status'
            );
        }

        unset($_POST['sgpd_note']);
        delete_transient('sgpd_proof_note_' . md5($token));
    }

    /**
     * request_changes() is only allowed from 'sent' and 'changes_requested'
     * (ProofWorkflow::TABLE). Approving first, then requesting a change,
     * reaches the forbidden transition through the real API rather than by
     * poking the row directly.
     */
    public function test_handle_changes_refuses_a_note_once_the_proof_is_approved(): void {
        [$repo, $id, $token] = $this->make_sent_design();
        (new ProofWorkflow($repo))->approve($token);

        $page = new ProofPage();
        $_POST['sgpd_note'] = 'Please make the text bigger.';
        $design = $repo->get($id);

        $notice = $this->invoke_handle_changes($page, $design, $token);

        $this->assertSame('This proof can no longer be changed.', $notice);
        $this->assertNotSame('', $notice, 'a forbidden transition must not be reported as success');
        $this->assertSame(
            'approved',
            $repo->get($id)['proof_status'],
            'a refused note must not disturb the approved state'
        );

        unset($_POST['sgpd_note']);
        delete_transient('sgpd_proof_note_' . md5($token));
    }

    /**
     * Positive control: proves the two refusal tests above are not passing
     * for some unrelated reason (e.g. the method always returning early).
     */
    public function test_handle_changes_accepts_a_real_note_and_stores_it(): void {
        [$repo, $id, $token] = $this->make_sent_design();
        $page = new ProofPage();

        $_POST['sgpd_note'] = 'Please make the text bigger and move the logo left.';
        $design = $repo->get($id);

        $notice = $this->invoke_handle_changes($page, $design, $token);

        $this->assertSame('', $notice);
        $after = $repo->get($id);
        $this->assertSame('changes_requested', $after['proof_status']);
        $this->assertSame('Please make the text bigger and move the logo left.', $after['proof_note']);

        unset($_POST['sgpd_note']);
        delete_transient('sgpd_proof_note_' . md5($token));
    }
}

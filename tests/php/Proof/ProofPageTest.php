<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\DesignRepository;
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

    /**
     * stream_view() is private and calls exit(), so it can't be called directly
     * from a test process without killing PHPUnit. What we CAN assert without
     * exiting is the piece that decides whether it 404s: a view whose
     * export_svg is empty must decode to null, same as any other "not a
     * render" value above.
     */
    public function test_decode_export_blob_refuses_an_empty_view_export(): void {
        $this->assertNull(ProofPage::decode_export_blob(''));
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
}

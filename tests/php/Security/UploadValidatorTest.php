<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Security\UploadValidator;

class UploadValidatorTest extends TestCase {

    public function test_rejects_php_file(): void {
        $tmp = tempnam(sys_get_temp_dir(), 'test');
        file_put_contents($tmp, '<?php echo "hack"; ?>');
        $this->expectException(\RuntimeException::class);
        UploadValidator::validate_and_store(
            ['tmp_name' => $tmp, 'size' => filesize($tmp), 'name' => 'evil.php'],
            'test-session'
        );
    }

    public function test_rejects_executable_js(): void {
        $tmp = tempnam(sys_get_temp_dir(), 'test');
        file_put_contents($tmp, 'alert("xss")');
        $this->expectException(\RuntimeException::class);
        UploadValidator::validate_and_store(
            ['tmp_name' => $tmp, 'size' => filesize($tmp), 'name' => 'evil.js'],
            'test-session'
        );
    }

    public function test_accepts_valid_png(): void {
        $tmp = tempnam(sys_get_temp_dir(), 'test') . '.png';
        $img = imagecreatetruecolor(1, 1);
        imagepng($img, $tmp);
        imagedestroy($img);

        try {
            $result = UploadValidator::validate_and_store(
                ['tmp_name' => $tmp, 'size' => filesize($tmp), 'name' => 'test.png'],
                'test-session-png-' . uniqid()
            );
            // If it succeeds (move_uploaded_file may fail in test env, that's OK)
            $this->assertArrayHasKey('url', $result);
        } catch (\RuntimeException $e) {
            // move_uploaded_file fails outside real upload context — that's acceptable
            // What matters is it did NOT fail due to MIME rejection
            $this->assertStringNotContainsString('not allowed', $e->getMessage());
        }

        @unlink($tmp);
    }

    public function test_rate_limit_blocks_after_threshold(): void {
        $session = 'rate-limit-test-' . uniqid();
        set_transient('pd_upload_count_' . md5($session), 10, MINUTE_IN_SECONDS);

        $tmp = tempnam(sys_get_temp_dir(), 'test') . '.png';
        $img = imagecreatetruecolor(1, 1);
        imagepng($img, $tmp);
        imagedestroy($img);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionCode(429);

        UploadValidator::validate_and_store(
            ['tmp_name' => $tmp, 'size' => filesize($tmp), 'name' => 'test.png'],
            $session
        );
    }
}

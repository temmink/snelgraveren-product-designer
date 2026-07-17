/**
 * Editor UI for the ProductForge Designer block.
 *
 * Plain JS on purpose (wp.* globals, no build step): the block is dynamic —
 * the real designer renders server-side via the [productforge] pipeline, so
 * the editor only needs a recognizable placeholder.
 */
(function (blocks, element, i18n, blockEditor) {
    'use strict';

    var el = element.createElement;
    var __ = i18n.__;

    blocks.registerBlockType('productforge/designer', {
        edit: function () {
            var blockProps = blockEditor.useBlockProps({
                style: {
                    border: '2px dashed #8c8f94',
                    borderRadius: '6px',
                    padding: '32px 16px',
                    textAlign: 'center',
                    background: '#f6f7f7',
                    color: '#3c434a'
                }
            });

            return el(
                'div',
                blockProps,
                el('div', { style: { fontSize: '28px', lineHeight: 1 } }, '🎨'),
                el('div', { style: { fontWeight: 600, margin: '8px 0 4px' } }, __('ProductForge Designer', 'productforge')),
                el(
                    'div',
                    { style: { fontSize: '13px' } },
                    __('The product designer renders here for customers, on products that have a designer template enabled.', 'productforge')
                )
            );
        },

        // Dynamic block: server renders the output, nothing is saved.
        save: function () {
            return null;
        }
    });
})(window.wp.blocks, window.wp.element, window.wp.i18n, window.wp.blockEditor);

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ClipartPicker from '../../../frontend/js/designer/src/components/ClipartPicker';

const collection = {
    id: 1,
    name: 'Dieren',
    items: [
        { id: 11, name: 'Hond', svg_url: 'https://example.test/dog.svg' },
        { id: 12, name: 'Kat', svg_url: 'https://example.test/cat.svg' },
    ],
};

function renderPicker(overrides = {}) {
    const props = {
        collection,
        onSelect: jest.fn(),
        onClose: jest.fn(),
        ...overrides,
    };
    const utils = render(<ClipartPicker {...props} />);
    return { ...utils, props };
}

describe('ClipartPicker', () => {
    test('renders a dialog with the collection name and one button per item', () => {
        renderPicker();

        const dialog = screen.getByRole('dialog', { name: 'Dieren' });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Hond' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Kat' })).toBeInTheDocument();
    });

    test('clicking an item reports the svg_url via onSelect', () => {
        const { props } = renderPicker();

        fireEvent.click(screen.getByRole('button', { name: 'Kat' }));

        expect(props.onSelect).toHaveBeenCalledWith('https://example.test/cat.svg');
    });

    test('clicking the close button calls onClose', () => {
        const { props } = renderPicker();

        fireEvent.click(screen.getByRole('button', { name: /close/i }));

        expect(props.onClose).toHaveBeenCalled();
        expect(props.onSelect).not.toHaveBeenCalled();
    });

    test('clicking the backdrop (outside the panel) calls onClose', () => {
        const { props } = renderPicker();

        fireEvent.click(screen.getByRole('dialog', { name: 'Dieren' }));

        expect(props.onClose).toHaveBeenCalled();
    });

    test('clicking inside the panel does NOT close', () => {
        const { props } = renderPicker();

        fireEvent.click(screen.getByText('Dieren'));

        expect(props.onClose).not.toHaveBeenCalled();
    });

    test('Escape closes the picker and does not reach document-level listeners', () => {
        // The modal display mode closes the whole designer on a document-level
        // Escape listener — the picker must swallow the key so only the picker
        // closes, not the designer around it.
        const documentListener = jest.fn();
        document.addEventListener('keydown', documentListener);

        const { props } = renderPicker();
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Dieren' }), { key: 'Escape' });

        expect(props.onClose).toHaveBeenCalled();
        expect(documentListener).not.toHaveBeenCalled();

        document.removeEventListener('keydown', documentListener);
    });

    test('moves focus into the picker on mount and restores it on unmount', () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();

        const { unmount } = renderPicker();
        expect(screen.getByRole('dialog', { name: 'Dieren' }).contains(document.activeElement)).toBe(true);

        unmount();
        expect(document.activeElement).toBe(outside);

        outside.remove();
    });
});

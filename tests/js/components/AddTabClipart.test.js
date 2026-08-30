import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AddTab from '../../../frontend/js/designer/src/components/tabs/AddTab';
import useDesignerStore from '../../../frontend/js/designer/src/store/useDesignerStore';

const collections = [
    {
        id: 1,
        name: 'Dieren',
        items: [
            { id: 11, name: 'Hond', svg_url: 'https://example.test/dog.svg' },
            { id: 12, name: 'Kat', svg_url: 'https://example.test/cat.svg' },
        ],
    },
    {
        id: 2,
        name: 'Kaders',
        items: [{ id: 21, name: 'Ovaal', svg_url: 'https://example.test/oval.svg' }],
    },
];

describe('AddTab clipart categories', () => {
    let addClipart;

    beforeEach(() => {
        addClipart = jest.fn();
        useDesignerStore.setState({
            template: {
                id: 1,
                views: [{ zones_config: [] }],
                global_config: { clipart_enabled: true },
            },
            currentViewIndex: 0,
            clipartCollections: collections,
            addClipart,
        });
    });

    test('shows one category button per collection instead of every item', () => {
        render(<AddTab />);

        expect(screen.getByRole('button', { name: /Dieren/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Kaders/ })).toBeInTheDocument();
        // Individual items are not rendered until a category is opened.
        expect(screen.queryByRole('button', { name: 'Hond' })).not.toBeInTheDocument();
    });

    test('clicking a category opens the picker with that collection', () => {
        render(<AddTab />);

        fireEvent.click(screen.getByRole('button', { name: /Dieren/ }));

        expect(screen.getByRole('dialog', { name: 'Dieren' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Hond' })).toBeInTheDocument();
    });

    test('choosing a clipart adds it and closes the picker', () => {
        render(<AddTab />);

        fireEvent.click(screen.getByRole('button', { name: /Dieren/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Kat' }));

        expect(addClipart).toHaveBeenCalledWith('https://example.test/cat.svg');
        expect(screen.queryByRole('dialog', { name: 'Dieren' })).not.toBeInTheDocument();
    });

    test('closing the picker without choosing adds nothing', () => {
        render(<AddTab />);

        fireEvent.click(screen.getByRole('button', { name: /Dieren/ }));
        fireEvent.click(screen.getByRole('button', { name: /close/i }));

        expect(addClipart).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: 'Dieren' })).not.toBeInTheDocument();
    });
});

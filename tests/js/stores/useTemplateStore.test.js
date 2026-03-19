import useTemplateStore from '../../../admin/js/template-builder/src/store/useTemplateStore.js';

// Reset the store between tests by re-importing a fresh state each time.
function getStore() {
    return useTemplateStore.getState();
}

function resetStore() {
    useTemplateStore.setState({
        id: 0,
        title: '',
        slug: '',
        status: 'draft',
        views: [],
        currentViewIndex: 0,
        isDirty: false,
        isSaving: false,
        isFreeMove: false,
        removedViewIds: [],
        history: {},
    });
}

beforeEach(() => {
    resetStore();
});

describe('useTemplateStore — initial state', () => {
    it('has empty views array', () => {
        expect(getStore().views).toEqual([]);
    });

    it('has currentViewIndex of 0', () => {
        expect(getStore().currentViewIndex).toBe(0);
    });

    it('has isDirty false', () => {
        expect(getStore().isDirty).toBe(false);
    });
});

describe('useTemplateStore — addView', () => {
    it('adds a view and increments views length', () => {
        getStore().addView({ name: 'Front' });
        expect(getStore().views).toHaveLength(1);
    });

    it('sets the view name correctly', () => {
        getStore().addView({ name: 'Front' });
        expect(getStore().views[0].name).toBe('Front');
    });

    it('assigns a _clientId to the new view', () => {
        getStore().addView({ name: 'Front' });
        expect(getStore().views[0]._clientId).toBeDefined();
        expect(typeof getStore().views[0]._clientId).toBe('string');
    });

    it('sets currentViewIndex to the new view index', () => {
        getStore().addView({ name: 'Front' });
        expect(getStore().currentViewIndex).toBe(0);
    });

    it('marks store as dirty', () => {
        getStore().addView({ name: 'Front' });
        expect(getStore().isDirty).toBe(true);
    });

    it('supports adding multiple views', () => {
        getStore().addView({ name: 'Front' });
        getStore().addView({ name: 'Back' });
        expect(getStore().views).toHaveLength(2);
        expect(getStore().currentViewIndex).toBe(1);
    });
});

describe('useTemplateStore — removeView', () => {
    it('removes a view by index', () => {
        getStore().addView({ name: 'Front' });
        getStore().addView({ name: 'Back' });
        getStore().removeView(0);
        expect(getStore().views).toHaveLength(1);
        expect(getStore().views[0].name).toBe('Back');
    });

    it('adjusts currentViewIndex when removing current view', () => {
        getStore().addView({ name: 'Front' });
        getStore().addView({ name: 'Back' });
        getStore().setCurrentViewIndex(1);
        getStore().removeView(1);
        expect(getStore().currentViewIndex).toBe(0);
    });

    it('marks store as dirty', () => {
        getStore().addView({ name: 'Front' });
        resetStore();
        // re-add without dirty flag to test removeView sets dirty
        useTemplateStore.setState({ views: [{ _clientId: 'abc', name: 'Front' }], isDirty: false });
        getStore().removeView(0);
        expect(getStore().isDirty).toBe(true);
    });
});

describe('useTemplateStore — setCurrentViewIndex', () => {
    it('updates currentViewIndex', () => {
        getStore().addView({ name: 'Front' });
        getStore().addView({ name: 'Back' });
        getStore().setCurrentViewIndex(1);
        expect(getStore().currentViewIndex).toBe(1);
    });
});

describe('useTemplateStore — setTitle', () => {
    it('updates the title', () => {
        getStore().setTitle('My Template');
        expect(getStore().title).toBe('My Template');
    });

    it('marks store as dirty', () => {
        getStore().setTitle('My Template');
        expect(getStore().isDirty).toBe(true);
    });
});

describe('useTemplateStore — undo/redo', () => {
    it('canUndo returns false when no history', () => {
        getStore().addView({ name: 'Front' });
        const viewKey = getStore().views[0]._clientId;
        expect(getStore().canUndo(viewKey)).toBe(false);
    });

    it('canUndo returns false with only one history entry', () => {
        getStore().addView({ name: 'Front' });
        const viewKey = getStore().views[0]._clientId;
        getStore().pushHistory(viewKey, '{"snapshot": 1}');
        expect(getStore().canUndo(viewKey)).toBe(false);
    });

    it('canUndo returns true with two history entries', () => {
        getStore().addView({ name: 'Front' });
        const viewKey = getStore().views[0]._clientId;
        getStore().pushHistory(viewKey, '{"snapshot": 1}');
        getStore().pushHistory(viewKey, '{"snapshot": 2}');
        expect(getStore().canUndo(viewKey)).toBe(true);
    });

    it('undo returns previous snapshot', () => {
        getStore().addView({ name: 'Front' });
        const viewKey = getStore().views[0]._clientId;
        getStore().pushHistory(viewKey, '{"snapshot": 1}');
        getStore().pushHistory(viewKey, '{"snapshot": 2}');
        const snapshot = getStore().undo(viewKey);
        expect(snapshot).toBe('{"snapshot": 1}');
    });

    it('canRedo returns true after undo', () => {
        getStore().addView({ name: 'Front' });
        const viewKey = getStore().views[0]._clientId;
        getStore().pushHistory(viewKey, '{"snapshot": 1}');
        getStore().pushHistory(viewKey, '{"snapshot": 2}');
        getStore().undo(viewKey);
        expect(getStore().canRedo(viewKey)).toBe(true);
    });

    it('redo returns the undone snapshot', () => {
        getStore().addView({ name: 'Front' });
        const viewKey = getStore().views[0]._clientId;
        getStore().pushHistory(viewKey, '{"snapshot": 1}');
        getStore().pushHistory(viewKey, '{"snapshot": 2}');
        getStore().undo(viewKey);
        const snapshot = getStore().redo(viewKey);
        expect(snapshot).toBe('{"snapshot": 2}');
    });

    it('undo returns null when pointer is at beginning', () => {
        getStore().addView({ name: 'Front' });
        const viewKey = getStore().views[0]._clientId;
        getStore().pushHistory(viewKey, '{"snapshot": 1}');
        const snapshot = getStore().undo(viewKey);
        expect(snapshot).toBeNull();
    });

    it('redo returns null when no future history', () => {
        getStore().addView({ name: 'Front' });
        const viewKey = getStore().views[0]._clientId;
        getStore().pushHistory(viewKey, '{"snapshot": 1}');
        const snapshot = getStore().redo(viewKey);
        expect(snapshot).toBeNull();
    });
});

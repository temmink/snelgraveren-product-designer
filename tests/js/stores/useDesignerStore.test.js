import useDesignerStore from '../../../frontend/js/designer/src/store/useDesignerStore.js';

function getStore() {
    return useDesignerStore.getState();
}

function resetStore() {
    useDesignerStore.setState({
        template: null,
        currentViewIndex: 0,
        designHash: null,
        isSaving: false,
        isDirty: false,
        canvasSnapshots: {},
        activeTool: 'select',
        selectedObject: null,
        error: null,
        triggerFileUpload: null,
        fabricCanvasRef: null,
    });
}

beforeEach(() => {
    resetStore();
});

describe('useDesignerStore — initial state', () => {
    it('has template as null', () => {
        expect(getStore().template).toBeNull();
    });

    it('has currentViewIndex of 0', () => {
        expect(getStore().currentViewIndex).toBe(0);
    });

    it('has activeTool of "select"', () => {
        expect(getStore().activeTool).toBe('select');
    });

    it('has selectedObject as null', () => {
        expect(getStore().selectedObject).toBeNull();
    });

    it('has isDirty false', () => {
        expect(getStore().isDirty).toBe(false);
    });

    it('has error as null', () => {
        expect(getStore().error).toBeNull();
    });
});

describe('useDesignerStore — loadTemplate', () => {
    it('stores the template data', () => {
        const templateData = { id: 1, title: 'Test Template', views: [] };
        getStore().loadTemplate(templateData);
        expect(getStore().template).toEqual(templateData);
    });

    it('resets currentViewIndex to 0', () => {
        getStore().setCurrentViewIndex(3);
        getStore().loadTemplate({ id: 1, views: [] });
        expect(getStore().currentViewIndex).toBe(0);
    });
});

describe('useDesignerStore — setCurrentViewIndex', () => {
    it('updates currentViewIndex', () => {
        getStore().setCurrentViewIndex(2);
        expect(getStore().currentViewIndex).toBe(2);
    });
});

describe('useDesignerStore — setActiveTool', () => {
    it('sets the active tool', () => {
        getStore().setActiveTool('text');
        expect(getStore().activeTool).toBe('text');
    });

    it('can switch between tools', () => {
        getStore().setActiveTool('image');
        expect(getStore().activeTool).toBe('image');
        getStore().setActiveTool('select');
        expect(getStore().activeTool).toBe('select');
    });
});

describe('useDesignerStore — setSelectedObject', () => {
    it('stores the selected object', () => {
        const obj = { type: 'i-text', text: 'Hello' };
        getStore().setSelectedObject(obj);
        expect(getStore().selectedObject).toEqual(obj);
    });

    it('can clear selected object by setting null', () => {
        getStore().setSelectedObject({ type: 'rect' });
        getStore().setSelectedObject(null);
        expect(getStore().selectedObject).toBeNull();
    });
});

describe('useDesignerStore — setDesignHash', () => {
    it('stores the design hash', () => {
        getStore().setDesignHash('abc123hash');
        expect(getStore().designHash).toBe('abc123hash');
    });
});

describe('useDesignerStore — error handling', () => {
    it('setError stores an error message', () => {
        getStore().setError('Something went wrong');
        expect(getStore().error).toBe('Something went wrong');
    });

    it('clearError resets error to null', () => {
        getStore().setError('Something went wrong');
        getStore().clearError();
        expect(getStore().error).toBeNull();
    });
});

describe('useDesignerStore — snapshotView', () => {
    it('stores a canvas snapshot for a view index', () => {
        const json = '{"objects":[]}';
        getStore().snapshotView(0, json);
        expect(getStore().canvasSnapshots[0]).toBe(json);
    });

    it('marks store as dirty', () => {
        getStore().snapshotView(0, '{"objects":[]}');
        expect(getStore().isDirty).toBe(true);
    });

    it('stores snapshots for multiple views independently', () => {
        getStore().snapshotView(0, '{"view":0}');
        getStore().snapshotView(1, '{"view":1}');
        expect(getStore().canvasSnapshots[0]).toBe('{"view":0}');
        expect(getStore().canvasSnapshots[1]).toBe('{"view":1}');
    });
});

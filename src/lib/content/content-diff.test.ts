import {expect,it} from 'vitest';
import {buildContentDiff} from './admin-view';import {getCanonicalPersonal,getCanonicalProjects} from './index';
it('shows actual nested before/after values and omits unchanged content',()=>{
 const canonicalPersonal=getCanonicalPersonal(),canonicalProjects=getCanonicalProjects();const draftProjects=structuredClone(canonicalProjects);draftProjects[0].evidence.note='Reviewed changed evidence';
 const diff=buildContentDiff({canonicalPersonal,canonicalProjects,draftPersonal:null,draftProjects});
 expect(diff.length).toBe(1);expect(diff[0].path).toContain('evidence');expect(JSON.stringify(diff[0].before)).toContain(canonicalProjects[0].evidence.note);expect(JSON.stringify(diff[0].after)).toContain('Reviewed changed evidence');
});

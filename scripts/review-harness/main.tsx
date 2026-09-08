import React from 'react';
import {createRoot} from 'react-dom/client';
import ReviewWorkspace from '../../src/components/review/ReviewWorkspace';
import ReviewInbox from '../../src/components/review/ReviewInbox';
import {AccountScopeProvider} from '../../src/components/platform/AccountScope';
const account='00000000-0000-4000-8000-000000000001';
createRoot(document.getElementById('root')!).render(window.location.pathname==='/inbox'?<AccountScopeProvider accountId={account} choices={[]}><div style={{padding:24,maxWidth:960,margin:'auto',fontFamily:'Arial,sans-serif'}}><p>LOCAL TEST — synthetic fixtures, not client work</p><ReviewInbox accountId={account} generation={1}/></div></AccountScopeProvider>:<ReviewWorkspace accountId={account} generation={1} outputId="00000000-0000-4000-8000-000000000004"/>);

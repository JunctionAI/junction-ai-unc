import React from 'react';
import {createRoot} from 'react-dom/client';
import ReviewWorkspace from '../../src/components/review/ReviewWorkspace';
createRoot(document.getElementById('root')!).render(<ReviewWorkspace accountId="00000000-0000-4000-8000-000000000001" generation={1} outputId="00000000-0000-4000-8000-000000000004"/>);

import React from 'react';
import {createRoot} from 'react-dom/client';
import {NotificationSettings} from '../../../apps/web/src/notifications';
import {ObservationPanel,ClimateNormalsPanel,AccuracyPanel} from '../../../apps/web/src/source-panels';
import '../../../apps/web/src/styles.css';
import '../../../apps/web/src/ui-controls.css';
const location={id:'test',name:'Fixture Tulsa',latitude:36.1,longitude:-95.9,country:'US',timezone:'America/Chicago'};
createRoot(document.getElementById('root')!).render(<main style={{padding:16,maxWidth:1100,margin:'auto'}}><h1>Test fixtures only</h1><NotificationSettings saved={[location]} online={true}/><ObservationPanel location={location} online={true} units="us"/><AccuracyPanel location={location} online={true} units="us"/><ClimateNormalsPanel online={true} units="us"/></main>);

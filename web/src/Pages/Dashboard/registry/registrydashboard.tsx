import { useConnection } from '../../../Context/ConnectionContext/connectionContext';
import { useUserContext } from '../../../Context/UserInformationContext/userInformationContext';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Chart from 'react-apexcharts';
import ButtonGroup from 'antd/lib/button/button-group';
import { RegistryDashboardComponent } from '@undp/carbon-library';

const RegistryDashboard = () => {
  const { t } = useTranslation(['dashboard']);
  return (
    <RegistryDashboardComponent
      useUserContext={useUserContext}
      useConnection={useConnection}
      Chart={Chart}
      t={t}
      ButtonGroup={ButtonGroup}
      Link={Link}
      isMultipleDashboardsVisible={true}
    ></RegistryDashboardComponent>
  );
};

export default RegistryDashboard;

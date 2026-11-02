import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';

export default function NotFound() {
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <Empty title="Page not found" action={<Link to="/" className="btn primary">Back to the board</Link>}>There's nothing at this address.</Empty>
    </div>
  );
}

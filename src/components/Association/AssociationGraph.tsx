import type {
  AssociationEdgeType,
  AssociationGraph as GraphData,
} from '@app/hooks/useAssociations';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useRouter } from 'next/router';
import { useMemo } from 'react';
import { nodeHref, nodeImage, nodeTitle } from './helpers';

const EDGE_COLOR: Record<AssociationEdgeType, string> = {
  similar: '#6366f1',
  recommended: '#22d3ee',
  'shared-person': '#f59e0b',
  'shared-genre': '#64748b',
};

interface GraphNodeData {
  label: string;
  image?: string;
  href?: string;
  isRoot?: boolean;
  [key: string]: unknown;
}

const GraphNode = ({ data }: { data: GraphNodeData }) => (
  <div
    className={`flex w-36 flex-col items-center gap-1 rounded-lg border p-2 text-center ${
      data.isRoot
        ? 'border-indigo-400 bg-indigo-900/60'
        : 'border-gray-600 bg-gray-800'
    }`}
  >
    <Handle type="target" position={Position.Top} className="!bg-gray-500" />
    {data.image && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={data.image} alt="" className="h-20 w-14 rounded object-cover" />
    )}
    <span className="line-clamp-2 text-xs font-semibold text-white">
      {data.label}
    </span>
    <Handle type="source" position={Position.Bottom} className="!bg-gray-500" />
  </div>
);

const nodeTypes = { assoc: GraphNode };

const AssociationGraph = ({ graph }: { graph: GraphData }) => {
  const router = useRouter();

  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    rfNodes.push({
      id: 'root',
      type: 'assoc',
      position: { x: 0, y: 0 },
      data: { label: graph.root.title, isRoot: true },
      draggable: false,
    });

    const ring = graph.edges.slice(0, 24);
    const radius = 360;
    ring.forEach((edge, i) => {
      const angle = (i / ring.length) * 2 * Math.PI;
      const id = `${edge.node.mediaType}:${edge.node.id}`;
      rfNodes.push({
        id,
        type: 'assoc',
        position: {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius + radius,
        },
        data: {
          label: nodeTitle(edge.node),
          image: nodeImage(edge.node),
          href: nodeHref(edge.node),
        },
      });
      rfEdges.push({
        id: `e-${id}`,
        source: 'root',
        target: id,
        animated: edge.type === 'shared-person',
        style: { stroke: EDGE_COLOR[edge.type], strokeWidth: 2 },
        label: edge.reason,
        labelStyle: { fill: '#cbd5e1', fontSize: 10 },
        labelBgStyle: { fill: '#1f2937' },
      });
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [graph]);

  return (
    <div className="h-[70vh] w-full overflow-hidden rounded-xl border border-gray-700 bg-gray-900">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          const href = (node.data as GraphNodeData).href;
          if (href) {
            router.push(href);
          }
        }}
      >
        <Background color="#374151" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

export default AssociationGraph;
